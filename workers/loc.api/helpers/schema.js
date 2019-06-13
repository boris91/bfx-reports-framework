'use strict'

const { cloneDeep } = require('lodash')

const {
  paramsSchemaForCsv
} = require('bfx-report/workers/loc.api/helpers/schema')

const paramsSchemaForCandlesApi = {
  type: 'object',
  properties: {
    timeframe: {
      type: 'string'
    },
    symbol: {
      type: 'string'
    },
    section: {
      type: 'string'
    },
    limit: {
      type: 'integer'
    },
    start: {
      type: 'integer'
    },
    end: {
      type: 'integer'
    },
    sort: {
      type: 'integer'
    }
  }
}

const paramsSchemaForRiskApi = {
  type: 'object',
  properties: {
    timeframe: {
      type: 'string',
      enum: [
        'day',
        'month',
        'year'
      ]
    },
    start: {
      type: 'integer'
    },
    end: {
      type: 'integer'
    },
    skip: {
      type: 'array',
      minItems: 1,
      maxItems: 3,
      items: {
        type: 'string',
        enum: [
          'trades',
          'marginTrades',
          'fundingPayment',
          'movementFees'
        ]
      }
    }
  }
}

const paramsSchemaForBalanceHistoryApi = {
  type: 'object',
  properties: {
    timeframe: {
      type: 'string',
      enum: [
        'day',
        'month',
        'year'
      ]
    },
    start: {
      type: 'integer'
    },
    end: {
      type: 'integer'
    }
  }
}

const paramsSchemaForPositionsSnapshotApi = {
  type: 'object',
  properties: {
    end: {
      type: 'integer'
    }
  }
}

const paramsSchemaForFullSnapshotReportApi = {
  type: 'object',
  properties: {
    end: {
      type: 'integer'
    }
  }
}

const paramsSchemaForWinLossApi = {
  type: 'object',
  properties: {
    timeframe: {
      type: 'string',
      enum: [
        'day',
        'month',
        'year'
      ]
    },
    start: {
      type: 'integer'
    },
    end: {
      type: 'integer'
    }
  }
}

const {
  timezone,
  dateFormat
} = { ...paramsSchemaForCsv.properties }

const paramsSchemaForRiskCsv = {
  type: 'object',
  properties: {
    ...cloneDeep(paramsSchemaForRiskApi.properties),
    timezone,
    dateFormat
  }
}

const paramsSchemaForBalanceHistoryCsv = {
  type: 'object',
  properties: {
    ...cloneDeep(paramsSchemaForBalanceHistoryApi.properties),
    timezone,
    dateFormat
  }
}

const paramsSchemaForWinLossCsv = {
  type: 'object',
  properties: {
    ...cloneDeep(paramsSchemaForWinLossApi.properties),
    timezone,
    dateFormat
  }
}

const paramsSchemaForFullSnapshotReportCsv = {
  type: 'object',
  properties: {
    end: {
      type: 'integer'
    },
    timezone,
    dateFormat
  }
}

module.exports = {
  paramsSchemaForCandlesApi,
  paramsSchemaForRiskApi,
  paramsSchemaForBalanceHistoryApi,
  paramsSchemaForWinLossApi,
  paramsSchemaForPositionsSnapshotApi,
  paramsSchemaForFullSnapshotReportApi,
  paramsSchemaForRiskCsv,
  paramsSchemaForBalanceHistoryCsv,
  paramsSchemaForWinLossCsv,
  paramsSchemaForFullSnapshotReportCsv
}
