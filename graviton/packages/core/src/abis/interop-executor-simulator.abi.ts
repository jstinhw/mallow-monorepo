export const INTEROP_EXECUTOR_SIMULATOR_ABI = [
  {
    type: 'function',
    name: 'simulateOpen',
    inputs: [
      {
        name: 'interopExecutor',
        type: 'address',
        internalType: 'address payable',
      },
      {
        name: 'order',
        type: 'tuple',
        internalType: 'struct Order',
        components: [
          { name: 'sender', type: 'address', internalType: 'address' },
          { name: 'openDeadline', type: 'uint32', internalType: 'uint32' },
          { name: 'fillDeadline', type: 'uint32', internalType: 'uint32' },
          { name: 'initData', type: 'bytes', internalType: 'bytes' },
          {
            name: 'targetIntent',
            type: 'tuple',
            internalType: 'struct TargetIntent',
            components: [
              { name: 'nonce', type: 'uint256', internalType: 'uint256' },
              { name: 'chainId', type: 'uint256', internalType: 'uint256' },
              { name: 'token', type: 'address', internalType: 'address' },
              { name: 'amount', type: 'uint256', internalType: 'uint256' },
              {
                name: 'validations',
                type: 'tuple[]',
                internalType: 'struct ValidationCall[]',
                components: [
                  {
                    name: 'validator',
                    type: 'address',
                    internalType: 'contract IInteropValidator',
                  },
                  { name: 'data', type: 'bytes', internalType: 'bytes' },
                ],
              },
              {
                name: 'executions',
                type: 'tuple[]',
                internalType: 'struct ExecutionCall[]',
                components: [
                  { name: 'data', type: 'bytes', internalType: 'bytes' },
                  { name: 'mode', type: 'bytes32', internalType: 'bytes32' },
                ],
              },
            ],
          },
          {
            name: 'srcIntent',
            type: 'tuple',
            internalType: 'struct SrcIntent',
            components: [
              { name: 'chainId', type: 'uint256', internalType: 'uint256' },
              { name: 'nonce', type: 'uint256', internalType: 'uint256' },
              {
                name: 'paymentTokens',
                type: 'tuple[]',
                internalType: 'struct PaymentToken[]',
                components: [
                  {
                    name: 'recipient',
                    type: 'address',
                    internalType: 'address',
                  },
                  { name: 'token', type: 'address', internalType: 'address' },
                  { name: 'amount', type: 'uint256', internalType: 'uint256' },
                ],
              },
              {
                name: 'preHooks',
                type: 'tuple[]',
                internalType: 'struct Call[]',
                components: [
                  { name: 'to', type: 'address', internalType: 'address' },
                  { name: 'value', type: 'uint256', internalType: 'uint256' },
                  { name: 'data', type: 'bytes', internalType: 'bytes' },
                ],
              },
              {
                name: 'postHooks',
                type: 'tuple[]',
                internalType: 'struct Call[]',
                components: [
                  { name: 'to', type: 'address', internalType: 'address' },
                  { name: 'value', type: 'uint256', internalType: 'uint256' },
                  { name: 'data', type: 'bytes', internalType: 'bytes' },
                ],
              },
              { name: 'token', type: 'address', internalType: 'address' },
              { name: 'amount', type: 'uint256', internalType: 'uint256' },
              {
                name: 'adapter',
                type: 'address',
                internalType: 'contract IAdapter',
              },
              { name: 'adapterData', type: 'bytes', internalType: 'bytes' },
            ],
          },
          { name: 'signature', type: 'bytes', internalType: 'bytes' },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
] as const;
