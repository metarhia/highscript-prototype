'use strict';

// Mock currency exchange: fixed rates from config (value of a unit in USD),
// every quote is stored with its rate and expiration time.

const fail = (code, message) => Object.assign(new Error(message), { code });

const open = async ({ options, database, schemas, logger }) => {
  const quotes = await database.collection('quotes', schemas.QuoteRecord);
  const { rates, ttlSeconds } = options;

  const quote = async ({ from, to, amountMinor }) => {
    if (!rates[from] || !rates[to]) {
      throw fail('INVALID_INPUT', 'Unsupported currency');
    }
    const rate = rates[from] / rates[to];
    const converted = Math.max(1, Math.round(amountMinor * rate));
    const createdAt = new Date();
    const expiresAt = new Date(
      createdAt.getTime() + ttlSeconds * 1000,
    ).toISOString();
    const record = await quotes.insert({
      quoteId: `q_${database.newId()}`,
      from,
      to,
      rate,
      sourceMinor: amountMinor,
      amountMinor: converted,
      expiresAt,
      createdAt: createdAt.toISOString(),
    });
    logger.info(
      `quote ${record.quoteId}: ${amountMinor} ${from} = ${converted} ${to}`,
    );
    return {
      quoteId: record.quoteId,
      amountMinor: converted,
      currency: to,
      expiresAt,
    };
  };

  return Object.freeze({ quote });
};

module.exports = { open };
