# Graviton Relayer API

## Gas Estimation Endpoint

### Overview

The Gas Estimation API provides a unified, scalable endpoint for estimating gas costs for different blockchain operations related to cross-chain order execution.

### Endpoint

```
POST /v1/gas
```

### Important Notes on JSON Compatibility

Since JSON doesn't natively support BigInt, all BigInt values in requests must be sent as **strings**. This includes:

- `chainId` fields
- `nonce` fields
- `amount` fields
- `value` fields

The API automatically transforms these string values to BigInt internally. You can also send numbers for smaller values, and they will be automatically converted.

### Design Principles

1. **Single Endpoint, Multiple Operations**: Uses a discriminated union pattern to handle different operation types through one endpoint
2. **Type-Safe Validation**: Leverages Zod schemas with TypeScript for compile-time and runtime type safety
3. **Extensible**: Easy to add new operation types without breaking existing clients
4. **Consistent Response Format**: All operations return the same response structure
5. **Service Layer Separation**: Business logic isolated in dedicated service classes

### Supported Operations

#### 1. Open Operation

Estimates gas for opening an order on the source chain.

**Request:**

```json
{
  "operation": "open",
  "order": {
    "sender": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
    "openDeadline": 1234567890,
    "fillDeadline": 1234567890,
    "initData": "0x",
    "targetIntent": {
      "nonce": "0",
      "chainId": "8453",
      "token": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "amount": "1000000",
      "validations": [],
      "executions": []
    },
    "srcIntent": {
      "chainId": "42161",
      "nonce": "0",
      "paymentTokens": [],
      "preHooks": [],
      "postHooks": [],
      "token": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      "amount": "1000000",
      "adapter": "0x6Dbb7425F8b2DECE6ffE1326a6252182852177B2",
      "adapterData": "0x"
    },
    "signature": "0x"
  }
}
```

**Important:** BigInt values (nonce, chainId, amount) must be sent as **strings** in JSON to avoid precision loss and ensure compatibility.

#### 2. Fill Operation

Estimates gas for filling an order on the target chain.

**Request:**

```json
{
  "operation": "fill",
  "order": { ... },
  "token": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "amount": "1000000",
  "chainId": 8453  // optional, defaults to order.targetIntent.chainId
}
```

#### 3. Simulate Operation

Estimates gas using a simulator contract for more accurate predictions. This operation simulates the actual execution environment to provide realistic gas estimates.

**Request:**

```json
{
  "operation": "simulate",
  "order": { ... },
  "chainId": 42161  // optional
}
```

### Response Format

All operations return a consistent response format:

```json
{
  "success": true,
  "operation": "open",
  "chainId": 42161,
  "estimate": {
    "gasLimit": "500000",
    "maxFeePerGas": "20000000000",
    "maxPriorityFeePerGas": "1500000000",
    "estimatedCostWei": "10000000000000000",
    "estimatedCostEth": "0.010000"
  },
  "metadata": {
    "simulatorUsed": true,
    "estimatedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

### Error Handling

#### Validation Errors (400)

```json
{
  "success": false,
  "error": "Validation failed",
  "details": [
    {
      "path": "operation",
      "message": "Invalid operation type"
    }
  ]
}
```

#### Server Errors (500)

```json
{
  "success": false,
  "error": "Error message describing what went wrong"
}
```

## Architecture

### Layers

1. **Route Layer** (`/api/routes/v1/gas-estimate.ts`)
   - Handles HTTP requests/responses
   - Validates input using Zod schemas
   - Routes to appropriate service methods

2. **Service Layer** (`/services/gas-estimation.service.ts`)
   - Contains business logic for gas estimation
   - Orchestrates blockchain clients and estimators
   - Returns structured results

3. **Blockchain Layer** (`/blockchain/*`)
   - Interacts with smart contracts
   - Manages blockchain clients
   - Performs actual gas estimation calls

### Benefits

- **Maintainability**: Clear separation of concerns, easy to locate and update logic
- **Scalability**: Adding new operation types requires minimal changes
- **Type Safety**: Full TypeScript coverage with Zod runtime validation
- **Testability**: Each layer can be tested independently
- **Versioning**: `/v1` prefix allows for future API versions without breaking changes
- **Documentation**: Self-documenting code with TypeScript types and JSDoc comments

## Adding New Operations

To add a new operation type:

1. **Add Schema** in `/api/schemas/gas-estimate.schema.ts`:

```typescript
export const newOperationSchema = baseEstimateSchema.extend({
  operation: z.literal('new-operation'),
  // ... additional parameters
});

// Add to discriminated union
export const gasEstimateRequestSchema = z.discriminatedUnion('operation', [
  openGasEstimateSchema,
  fillGasEstimateSchema,
  simulateGasEstimateSchema,
  newOperationSchema, // Add here
]);
```

2. **Add Service Method** in `/services/gas-estimation.service.ts`:

```typescript
async estimateNewOperation(order: Order, params: any): Promise<GasEstimationResult> {
  // Implementation
}
```

3. **Add Route Handler** in `/api/routes/v1/gas-estimate.ts`:

```typescript
case 'new-operation':
  result = await gasEstimationService.estimateNewOperation(
    params.order,
    params
  );
  break;
```

That's it! The discriminated union ensures type safety throughout.

## Examples

### cURL Examples

**Open Operation:**

```bash
curl -X POST http://localhost:3001/v1/gas/estimate \
  -H "Content-Type: application/json" \
  -d '{
    "operation": "open",
    "order": { ... }
  }'
```

**Fill Operation:**

```bash
curl -X POST http://localhost:3001/v1/gas/estimate \
  -H "Content-Type: application/json" \
  -d '{
    "operation": "fill",
    "order": { ... },
    "token": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "amount": "1000000"
  }'
```

**Simulate Operation:**

```bash
curl -X POST http://localhost:3001/v1/gas/estimate \
  -H "Content-Type: application/json" \
  -d '{
    "operation": "simulate",
    "order": { ... }
  }'
```
