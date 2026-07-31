# Graviton Quoter

Quote aggregation API for Uniswap swaps and Circle CCTP bridges.

## TODO

### `POST /v1/quote/multi-input` (`src/services/quote/quote.service.ts`)

- [ ] Optimize by calculating the exact input amount locally from the quote instead of making another RPC call when exactInput swap output exceeds the remaining amount needed
- [ ] Optimize by getting the swap quotes in parallel instead of sequentially
