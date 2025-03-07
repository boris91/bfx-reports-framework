'use strict'

const { pipeline } = require('stream')
const { stringify } = require('csv')

const {
  write
} = require('bfx-report/workers/loc.api/queue/write-data-to-stream/helpers')

const nope = () => {}

module.exports = (
  rService,
  getDataFromApi
) => async (
  wStream,
  jobData
) => {
  const queue = rService.ctx.lokue_aggregator.q
  const {
    args: _args,
    columnsCsv,
    formatSettings,
    name
  } = { ...jobData }
  const { params: _params } = { ..._args }
  const params = {
    start: 0,
    end: Date.now(),
    ..._params
  }
  const args = { ..._args, params }
  const { start, end } = params
  const mtsCreated = Date.now()

  queue.emit('progress', 0)

  if (typeof jobData === 'string') {
    const stringifier = stringify(
      { columns: ['mess'] }
    )

    pipeline(stringifier, wStream, nope)
    write([{ mess: jobData }], stringifier)
    queue.emit('progress', 100)
    stringifier.end()

    return
  }

  wStream.setMaxListeners(50)

  const timestampsStringifier = stringify({
    header: true,
    columns: columnsCsv.timestamps
  })
  const startingPositionsSnapshotNameStringifier = stringify(
    { columns: ['name'] }
  )
  const startingPositionsSnapshotStringifier = stringify({
    header: true,
    columns: columnsCsv.positionsSnapshot
  })
  const endingPositionsSnapshotNameStringifier = stringify(
    { columns: ['name'] }
  )
  const endingPositionsSnapshotStringifier = stringify({
    header: true,
    columns: columnsCsv.positionsSnapshot
  })
  const finalStateNameStringifier = stringify(
    { columns: ['name'] }
  )
  const startingPeriodBalancesNameStringifier = stringify(
    { columns: ['name'] }
  )
  const startingPeriodBalancesStringifier = stringify({
    header: true,
    columns: columnsCsv.periodBalances
  })
  const movementsNameStringifier = stringify(
    { columns: ['name'] }
  )
  const movementsStringifier = stringify({
    header: true,
    columns: columnsCsv.movements
  })
  const movementsTotalAmountStringifier = stringify({
    header: true,
    columns: columnsCsv.movementsTotalAmount
  })
  const endingPeriodBalancesNameStringifier = stringify(
    { columns: ['name'] }
  )
  const endingPeriodBalancesStringifier = stringify({
    header: true,
    columns: columnsCsv.periodBalances
  })
  const totalResultStringifier = stringify({
    header: true,
    columns: columnsCsv.totalResult
  })

  const rStreamArr = [
    timestampsStringifier,
    startingPositionsSnapshotNameStringifier,
    startingPositionsSnapshotStringifier,
    endingPositionsSnapshotNameStringifier,
    endingPositionsSnapshotStringifier,
    finalStateNameStringifier,
    startingPeriodBalancesNameStringifier,
    startingPeriodBalancesStringifier,
    movementsNameStringifier,
    movementsStringifier,
    movementsTotalAmountStringifier,
    endingPeriodBalancesNameStringifier,
    endingPeriodBalancesStringifier,
    totalResultStringifier
  ]

  rStreamArr.forEach((rStream) => {
    pipeline(rStream, wStream, nope)
  })

  const res = await getDataFromApi({
    getData: rService[name].bind(rService),
    args,
    callerName: 'CSV_WRITER'
  })
  const {
    startingPositionsSnapshot,
    endingPositionsSnapshot,
    finalState: {
      startingPeriodBalances,
      movements,
      movementsTotalAmount,
      endingPeriodBalances,
      totalResult
    }
  } = { ...res }

  write(
    [{ mtsCreated, start, end }, {}],
    timestampsStringifier,
    formatSettings.timestamps,
    params
  )
  write(
    [{ name: 'STARTING POSITIONS SNAPSHOT' }],
    startingPositionsSnapshotNameStringifier
  )
  write(
    [...startingPositionsSnapshot, {}],
    startingPositionsSnapshotStringifier,
    formatSettings.positionsSnapshot,
    params
  )

  write(
    [{ name: 'ENDING POSITIONS SNAPSHOT' }],
    endingPositionsSnapshotNameStringifier
  )
  write(
    [...endingPositionsSnapshot, {}],
    endingPositionsSnapshotStringifier,
    formatSettings.positionsSnapshot,
    params
  )

  write(
    [{ name: 'FINAL STATE' }],
    finalStateNameStringifier
  )
  write(
    [{ name: 'STARTING PERIOD BALANCES' }],
    startingPeriodBalancesNameStringifier
  )
  write(
    [startingPeriodBalances, {}],
    startingPeriodBalancesStringifier
  )
  write(
    [{ name: 'MOVEMENTS DETAIL' }],
    movementsNameStringifier
  )
  write(
    [...movements, {}],
    movementsStringifier,
    formatSettings.movements,
    params
  )
  write(
    [{ movementsTotalAmount }, {}],
    movementsTotalAmountStringifier
  )
  write(
    [{ name: 'ENDING PERIOD BALANCES' }],
    endingPeriodBalancesNameStringifier
  )
  write(
    [endingPeriodBalances, {}],
    endingPeriodBalancesStringifier
  )
  write(
    [{ totalResult }],
    totalResultStringifier
  )

  queue.emit('progress', 100)

  startingPositionsSnapshotNameStringifier.end()
  startingPositionsSnapshotStringifier.end()
  endingPositionsSnapshotNameStringifier.end()
  endingPositionsSnapshotStringifier.end()
  finalStateNameStringifier.end()
  startingPeriodBalancesNameStringifier.end()
  startingPeriodBalancesStringifier.end()
  movementsNameStringifier.end()
  movementsStringifier.end()
  movementsTotalAmountStringifier.end()
  endingPeriodBalancesNameStringifier.end()
  endingPeriodBalancesStringifier.end()
  totalResultStringifier.end()
}
