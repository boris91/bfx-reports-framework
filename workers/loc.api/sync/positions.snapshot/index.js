'use strict'

const { orderBy } = require('lodash')

const {
  splitSymbolPairs
} = require('bfx-report/workers/loc.api/helpers')
const {
  groupByTimeframe,
  getStartMtsByTimeframe
} = require('../helpers')

const { decorateInjectable } = require('../../di/utils')

const depsTypes = (TYPES) => [
  TYPES.RService,
  TYPES.GetDataFromApi,
  TYPES.DAO,
  TYPES.ALLOWED_COLLS,
  TYPES.SYNC_API_METHODS,
  TYPES.FOREX_SYMBS,
  TYPES.SyncSchema,
  TYPES.CurrencyConverter,
  TYPES.Authenticator
]
class PositionsSnapshot {
  constructor (
    rService,
    getDataFromApi,
    dao,
    ALLOWED_COLLS,
    SYNC_API_METHODS,
    FOREX_SYMBS,
    syncSchema,
    currencyConverter,
    authenticator
  ) {
    this.rService = rService
    this.getDataFromApi = getDataFromApi
    this.dao = dao
    this.ALLOWED_COLLS = ALLOWED_COLLS
    this.SYNC_API_METHODS = SYNC_API_METHODS
    this.FOREX_SYMBS = FOREX_SYMBS
    this.syncSchema = syncSchema
    this.currencyConverter = currencyConverter
    this.authenticator = authenticator

    this.positionsHistoryModel = this.syncSchema.getModelsMap()
      .get(this.ALLOWED_COLLS.POSITIONS_HISTORY)
    this.positionsSnapshotModel = this.syncSchema.getModelsMap()
      .get(this.ALLOWED_COLLS.POSITIONS_SNAPSHOT)
    this.positionsSnapshotMethodColl = this.syncSchema.getMethodCollMap()
      .get(this.SYNC_API_METHODS.POSITIONS_SNAPSHOT)
    this.positionsSnapshotSymbolFieldName = this.positionsSnapshotMethodColl.symbolFieldName
  }

  _getPositionsHistory (
    user,
    endMts
  ) {
    return this.dao.getElemsInCollBy(
      this.ALLOWED_COLLS.POSITIONS_HISTORY,
      {
        filter: {
          user_id: user._id,
          $lte: { mtsCreate: endMts },
          $gte: { mtsUpdate: endMts }
        },
        sort: [['mtsUpdate', -1]],
        projection: this.positionsHistoryModel,
        exclude: ['user_id'],
        isExcludePrivate: true
      }
    )
  }

  _getPositionsSnapshotFromDb (
    user,
    params
  ) {
    const { start, end, sort } = { ...params }

    const isStartExisted = Number.isInteger(start)
    const isEndExisted = Number.isInteger(end)

    const gteFilter = isStartExisted
      ? { $gte: { mtsUpdate: start } }
      : {}
    const lteFilter = isEndExisted
      ? { $lte: { mtsUpdate: end } }
      : {}
    const _sort = (
      Array.isArray(sort) &&
      sort.length > 0
    )
      ? sort
      : [['mtsUpdate', -1], ['id', -1]]

    return this.dao.getElemsInCollBy(
      this.ALLOWED_COLLS.POSITIONS_SNAPSHOT,
      {
        filter: {
          user_id: user._id,
          ...gteFilter,
          ...lteFilter
        },
        sort: _sort,
        projection: this.positionsSnapshotModel,
        exclude: ['user_id'],
        isExcludePrivate: true
      }
    )
  }

  _findPositions (
    positionsAudit,
    reqStatus,
    endMts
  ) {
    return positionsAudit.find((posAudit) => {
      const { mtsUpdate, status } = { ...posAudit }

      if (!Number.isInteger(mtsUpdate)) {
        return false
      }

      return (
        status === reqStatus &&
        mtsUpdate <= endMts
      )
    })
  }

  _findActivePositions (
    positionsAudit,
    endMts
  ) {
    return this._findPositions(
      positionsAudit,
      'ACTIVE',
      endMts
    )
  }

  _findClosedPositions (
    positionsAudit,
    endMts
  ) {
    return this._findPositions(
      positionsAudit,
      'CLOSED',
      endMts
    )
  }

  _getPositionsIds (positionsHistory) {
    return positionsHistory.reduce(
      (accum, { id } = {}) => {
        if (Number.isInteger(id)) {
          accum.push(id)
        }

        return accum
      }, [])
  }

  async _convertPlToUsd (
    pl,
    symbol,
    end
  ) {
    const currency = splitSymbolPairs(symbol)[1]

    if (
      !currency ||
      currency.length < 3 ||
      !Number.isFinite(pl)
    ) {
      return {
        plUsd: null,
        currency
      }
    }

    const plData = { pl, plUsd: null, currency }
    const { plUsd } = await this.currencyConverter.convert(
      plData,
      {
        convertTo: 'USD',
        symbolFieldName: 'currency',
        mts: end,
        convFields: [
          { inputField: 'pl', outputField: 'plUsd' }
        ]
      }
    )

    return {
      plUsd,
      currency
    }
  }

  async _getCalculatedPositions (
    positions,
    end,
    opts = {}
  ) {
    const {
      isNotTickersRequired = false
    } = { ...opts }
    const positionsSnapshot = []
    const tickers = []
    const actualPrices = new Map()

    for (const position of positions) {
      const {
        symbol,
        basePrice,
        amount,
        marginFunding,
        mtsUpdate
      } = { ...position }
      const mts = end ?? mtsUpdate
      const priceCacheKey = `${symbol}-${mts}`

      const resPositions = {
        ...position,
        actualPrice: null,
        pl: null,
        plUsd: null,
        plPerc: null
      }

      if (typeof symbol !== 'string') {
        positionsSnapshot.push(resPositions)

        continue
      }
      if (!actualPrices.has(priceCacheKey)) {
        const _actualPrice = await this.currencyConverter
          .getPrice(symbol, mts)

        actualPrices.set(priceCacheKey, _actualPrice)
      }

      const actualPrice = actualPrices.get(priceCacheKey)

      if (
        !Number.isFinite(actualPrice) ||
        !Number.isFinite(basePrice) ||
        !Number.isFinite(amount)
      ) {
        positionsSnapshot.push(resPositions)

        continue
      }

      const _marginFunding = Number.isFinite(marginFunding)
        ? marginFunding
        : 0
      const isMarginFundingConverted = amount > 0
      const convertedMarginFunding = isMarginFundingConverted
        ? _marginFunding
        : _marginFunding * actualPrice

      const pl = ((actualPrice - basePrice) * amount) -
        Math.abs(convertedMarginFunding)
      const plPerc = ((actualPrice / basePrice) - 1) * 100 * Math.sign(amount)
      const {
        plUsd,
        currency
      } = await this._convertPlToUsd(
        pl,
        symbol,
        end
      )

      positionsSnapshot.push({
        ...resPositions,
        actualPrice,
        pl,
        plUsd,
        plPerc
      })

      if (
        !isNotTickersRequired &&
        currency &&
        currency !== 'USD' &&
        Number.isFinite(pl) &&
        Number.isFinite(plUsd)
      ) {
        const separator = currency.length > 3
          ? ':'
          : ''
        const symbol = `t${currency}${separator}USD`
        const amount = (
          pl !== 0 &&
          plUsd !== 0
        )
          ? plUsd / pl
          : await this.currencyConverter
            .getPrice(symbol, end)

        tickers.push({
          symbol,
          amount
        })
      }
    }

    return {
      positionsSnapshot,
      tickers
    }
  }

  _filterDuplicate (accum = [], curr = []) {
    if (
      !Array.isArray(accum) ||
      accum.length === 0
    ) {
      return [...curr]
    }

    const keys = Object.keys(accum[0]).filter(key => !/^_/.test(key))

    return curr.filter(currItem => {
      return accum.every(accumItem => {
        return keys.some(key => {
          return accumItem[key] !== currItem[key]
        })
      })
    })
  }

  async _getPositionsAudit (
    endMts,
    {
      auth = {},
      params: { ids } = {}
    } = {}
  ) {
    const positionsAudit = []

    for (const id of ids) {
      const singleIdRes = []

      let end = Date.now()
      let prevEnd = end
      let serialRequestsCount = 0

      while (true) {
        const _res = await this.getDataFromApi({
          getData: this.rService.getPositionsAudit.bind(this.rService),
          args: { auth, params: { id: [id], end, limit: 250 } },
          callerName: 'POSITIONS_SNAPSHOT',
          eNetErrorAttemptsTimeframeMin: 10 / 60,
          eNetErrorAttemptsTimeoutMs: 1000,
          shouldNotInterrupt: true
        })

        const { res, nextPage } = (
          Object.keys({ ..._res }).every(key => key !== 'nextPage')
        )
          ? { res: _res, nextPage: null }
          : _res

        prevEnd = end
        end = nextPage

        if (
          Array.isArray(res) &&
          res.length === 0 &&
          nextPage &&
          Number.isInteger(nextPage) &&
          serialRequestsCount < 1
        ) {
          serialRequestsCount += 1

          continue
        }

        serialRequestsCount = 0

        if (
          !Array.isArray(res) ||
          res.length === 0
        ) {
          break
        }

        const closedPos = this._findClosedPositions(
          res,
          endMts
        )

        if (
          closedPos &&
          typeof closedPos === 'object'
        ) {
          break
        }

        const activePos = this._findActivePositions(
          res,
          endMts
        )

        if (
          activePos &&
          typeof activePos === 'object'
        ) {
          positionsAudit.push(activePos)

          break
        }

        const resWithoutDuplicate = this._filterDuplicate(
          singleIdRes,
          res
        )
        singleIdRes.push(...resWithoutDuplicate)

        if (
          !Number.isInteger(nextPage) ||
          (
            resWithoutDuplicate.length === 0 &&
            end === prevEnd
          )
        ) {
          break
        }
      }
    }

    return positionsAudit
  }

  async _getActivePositions (
    auth,
    end
  ) {
    const activePositions = await this.getDataFromApi({
      getData: this.rService.getActivePositions.bind(this.rService),
      args: { auth },
      callerName: 'POSITIONS_SNAPSHOT',
      eNetErrorAttemptsTimeframeMin: 10 / 60,
      eNetErrorAttemptsTimeoutMs: 1000,
      shouldNotInterrupt: true
    })

    if (
      !Array.isArray(activePositions) ||
      activePositions.length === 0
    ) {
      return []
    }

    return activePositions
      .filter((position) => {
        const { mtsCreate } = { ...position }

        return mtsCreate <= end
      })
  }

  _mergePositions (
    positionsHistory = [],
    activePositions = []
  ) {
    const _activePositions = Array.isArray(activePositions)
      ? activePositions
      : []
    const _positionsHistory = Array.isArray(positionsHistory)
      ? positionsHistory
      : []
    const positions = [
      ..._activePositions,
      ..._positionsHistory
    ]

    return orderBy(positions, ['mtsUpdate'], ['desc'])
  }

  async _getPositionsAuditAndSnapshot (args) {
    const {
      auth = {},
      params = {}
    } = { ...args }
    const {
      end = Date.now()
    } = { ...params }
    const user = await this.authenticator
      .verifyRequestUser({ auth })
    const emptyRes = {
      positionsSnapshot: [],
      tickers: []
    }

    const positionsHistoryPromise = this._getPositionsHistory(
      user,
      end
    )
    const activePositionsPromise = this._getActivePositions(
      auth,
      end
    )

    const [
      positionsHistory,
      activePositions
    ] = await Promise.all([
      positionsHistoryPromise,
      activePositionsPromise
    ])

    const positions = this._mergePositions(
      positionsHistory,
      activePositions
    )

    if (
      !Array.isArray(positions) ||
      positions.length === 0
    ) {
      return emptyRes
    }

    const ids = this._getPositionsIds(positions)
    const positionsAudit = await this._getPositionsAudit(
      end,
      { auth, params: { ids } }
    )

    if (
      !Array.isArray(positionsAudit) ||
      positionsAudit.length === 0
    ) {
      return emptyRes
    }

    const {
      positionsSnapshot,
      tickers
    } = await this._getCalculatedPositions(
      positionsAudit,
      end
    )

    return {
      positionsSnapshot,
      tickers
    }
  }

  _calcPlFromPositionsSnapshots (positionsHistory) {
    return (
      positionsSnapshots = [],
      args = {}
    ) => {
      const { mts, timeframe } = args

      // Need to filter duplicate and closed positions as it can be for
      // week and month and year timeframe in daily positions snapshots
      // if daily timeframe no need to filter it
      const positions = this._filterPositionsSnapshots(
        positionsSnapshots,
        positionsHistory,
        timeframe,
        mts
      )

      return positions.reduce((accum, curr) => {
        const { plUsd } = { ...curr }
        const symb = 'USD'

        if (!Number.isFinite(plUsd)) {
          return accum
        }

        return {
          ...accum,
          [symb]: Number.isFinite(accum[symb])
            ? accum[symb] + plUsd
            : plUsd
        }
      }, {})
    }
  }

  _filterPositionsSnapshots (
    positionsSnapshots,
    positionsHistory,
    timeframe,
    mts
  ) {
    if (
      !Array.isArray(positionsSnapshots) ||
      positionsSnapshots.length === 0
    ) {
      return positionsSnapshots
    }

    return positionsSnapshots.reduce((accum, position) => {
      if (
        Number.isFinite(position?.id) &&
        accum.every((item) => item?.id !== position?.id) &&
        (
          timeframe === 'day' ||
          !this._isClosedPosition(positionsHistory, mts, position?.id)
        )
      ) {
        accum.push(position)
      }

      return accum
    }, [])
  }

  _isClosedPosition (positionsHistory, mts, id) {
    return (
      Array.isArray(positionsHistory) &&
      positionsHistory.length > 0 &&
      positionsHistory.some((item) => (
        item.id === id &&
        item.mts === mts
      ))
    )
  }

  async getPLSnapshot ({
    auth = {},
    params = {}
  } = {}) {
    const user = await this.authenticator
      .verifyRequestUser({ auth })

    const {
      timeframe = 'day',
      start = 0,
      end = Date.now()
    } = params ?? {}
    const args = {
      auth: user,
      params: {
        timeframe,
        start,
        end
      }
    }

    const dailyPositionsSnapshotsPromise = this
      .getSyncedPositionsSnapshot(args)
    const positionsHistoryPromise = this.dao.getElemsInCollBy(
      this.ALLOWED_COLLS.POSITIONS_HISTORY,
      {
        filter: {
          user_id: user._id,
          $gte: { mtsUpdate: start },
          $lte: { mtsUpdate: end }
        },
        sort: [['mtsUpdate', -1], ['id', -1]],
        projection: this.positionsHistoryModel,
        exclude: ['user_id'],
        isExcludePrivate: true
      }
    )

    const [
      dailyPositionsSnapshots,
      positionsHistory
    ] = await Promise.all([
      dailyPositionsSnapshotsPromise,
      positionsHistoryPromise
    ])

    const positionsHistoryNormByMts = positionsHistory.map((pos) => {
      if (Number.isFinite(pos?.mtsUpdate)) {
        pos.mts = getStartMtsByTimeframe(
          pos.mtsUpdate,
          timeframe
        )
      }

      return pos
    })

    const plGroupedByTimeframePromise = await groupByTimeframe(
      dailyPositionsSnapshots,
      { timeframe, start, end },
      this.FOREX_SYMBS,
      'mtsUpdate',
      this.positionsSnapshotSymbolFieldName,
      this._calcPlFromPositionsSnapshots(positionsHistoryNormByMts)
    )

    return plGroupedByTimeframePromise
  }

  async getSyncedPositionsSnapshot (args) {
    const {
      auth = {},
      params = {}
    } = { ...args }
    const {
      start,
      end
    } = { ...params }
    const user = await this.authenticator
      .verifyRequestUser({ auth })
    const emptyRes = []

    const syncedPositionsSnapshot = await this._getPositionsSnapshotFromDb(
      user,
      { start, end }
    )

    if (
      !Array.isArray(syncedPositionsSnapshot) ||
      syncedPositionsSnapshot.length === 0
    ) {
      return emptyRes
    }

    const {
      positionsSnapshot
    } = await this._getCalculatedPositions(
      syncedPositionsSnapshot,
      null,
      { isNotTickersRequired: true }
    )

    return positionsSnapshot
  }

  async getPositionsSnapshot (args) {
    const {
      positionsSnapshot
    } = await this._getPositionsAuditAndSnapshot(args)

    return positionsSnapshot
  }

  async getPositionsSnapshotAndTickers (args) {
    const {
      positionsSnapshot,
      tickers
    } = await this._getPositionsAuditAndSnapshot(args)

    return {
      positionsSnapshot,
      tickers
    }
  }
}

decorateInjectable(PositionsSnapshot, depsTypes)

module.exports = PositionsSnapshot
