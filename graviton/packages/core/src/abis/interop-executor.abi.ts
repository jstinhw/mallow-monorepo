export const INTEROP_EXECUTOR_ABI = [
  {
    type: 'constructor',
    inputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'receive',
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'executionNonce',
    inputs: [
      {
        name: '_sender',
        type: 'address',
        internalType: 'address',
      },
      {
        name: '_key',
        type: 'uint160',
        internalType: 'uint160',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'executionNonce',
    inputs: [
      {
        name: '_sender',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'fill',
    inputs: [
      {
        name: 'order',
        type: 'tuple',
        internalType: 'struct Order',
        components: [
          {
            name: 'sender',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'openDeadline',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'fillDeadline',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'initData',
            type: 'bytes',
            internalType: 'bytes',
          },
          {
            name: 'targetIntent',
            type: 'tuple',
            internalType: 'struct TargetIntent',
            components: [
              {
                name: 'nonce',
                type: 'uint256',
                internalType: 'uint256',
              },
              {
                name: 'chainId',
                type: 'uint256',
                internalType: 'uint256',
              },
              {
                name: 'token',
                type: 'address',
                internalType: 'address',
              },
              {
                name: 'amount',
                type: 'uint256',
                internalType: 'uint256',
              },
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
                  {
                    name: 'data',
                    type: 'bytes',
                    internalType: 'bytes',
                  },
                ],
              },
              {
                name: 'executions',
                type: 'tuple[]',
                internalType: 'struct ExecutionCall[]',
                components: [
                  {
                    name: 'data',
                    type: 'bytes',
                    internalType: 'bytes',
                  },
                  {
                    name: 'mode',
                    type: 'bytes32',
                    internalType: 'bytes32',
                  },
                ],
              },
            ],
          },
          {
            name: 'srcIntent',
            type: 'tuple',
            internalType: 'struct SrcIntent',
            components: [
              {
                name: 'chainId',
                type: 'uint256',
                internalType: 'uint256',
              },
              {
                name: 'nonce',
                type: 'uint256',
                internalType: 'uint256',
              },
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
                  {
                    name: 'token',
                    type: 'address',
                    internalType: 'address',
                  },
                  {
                    name: 'amount',
                    type: 'uint256',
                    internalType: 'uint256',
                  },
                ],
              },
              {
                name: 'preHooks',
                type: 'tuple[]',
                internalType: 'struct Call[]',
                components: [
                  {
                    name: 'to',
                    type: 'address',
                    internalType: 'address',
                  },
                  {
                    name: 'value',
                    type: 'uint256',
                    internalType: 'uint256',
                  },
                  {
                    name: 'data',
                    type: 'bytes',
                    internalType: 'bytes',
                  },
                ],
              },
              {
                name: 'postHooks',
                type: 'tuple[]',
                internalType: 'struct Call[]',
                components: [
                  {
                    name: 'to',
                    type: 'address',
                    internalType: 'address',
                  },
                  {
                    name: 'value',
                    type: 'uint256',
                    internalType: 'uint256',
                  },
                  {
                    name: 'data',
                    type: 'bytes',
                    internalType: 'bytes',
                  },
                ],
              },
              {
                name: 'token',
                type: 'address',
                internalType: 'address',
              },
              {
                name: 'amount',
                type: 'uint256',
                internalType: 'uint256',
              },
              {
                name: 'adapter',
                type: 'address',
                internalType: 'contract IAdapter',
              },
              {
                name: 'adapterData',
                type: 'bytes',
                internalType: 'bytes',
              },
            ],
          },
          {
            name: 'signature',
            type: 'bytes',
            internalType: 'bytes',
          },
        ],
      },
      {
        name: '',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'amount',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'getHash',
    inputs: [
      {
        name: 'order',
        type: 'tuple',
        internalType: 'struct Order',
        components: [
          {
            name: 'sender',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'openDeadline',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'fillDeadline',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'initData',
            type: 'bytes',
            internalType: 'bytes',
          },
          {
            name: 'targetIntent',
            type: 'tuple',
            internalType: 'struct TargetIntent',
            components: [
              {
                name: 'nonce',
                type: 'uint256',
                internalType: 'uint256',
              },
              {
                name: 'chainId',
                type: 'uint256',
                internalType: 'uint256',
              },
              {
                name: 'token',
                type: 'address',
                internalType: 'address',
              },
              {
                name: 'amount',
                type: 'uint256',
                internalType: 'uint256',
              },
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
                  {
                    name: 'data',
                    type: 'bytes',
                    internalType: 'bytes',
                  },
                ],
              },
              {
                name: 'executions',
                type: 'tuple[]',
                internalType: 'struct ExecutionCall[]',
                components: [
                  {
                    name: 'data',
                    type: 'bytes',
                    internalType: 'bytes',
                  },
                  {
                    name: 'mode',
                    type: 'bytes32',
                    internalType: 'bytes32',
                  },
                ],
              },
            ],
          },
          {
            name: 'srcIntent',
            type: 'tuple',
            internalType: 'struct SrcIntent',
            components: [
              {
                name: 'chainId',
                type: 'uint256',
                internalType: 'uint256',
              },
              {
                name: 'nonce',
                type: 'uint256',
                internalType: 'uint256',
              },
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
                  {
                    name: 'token',
                    type: 'address',
                    internalType: 'address',
                  },
                  {
                    name: 'amount',
                    type: 'uint256',
                    internalType: 'uint256',
                  },
                ],
              },
              {
                name: 'preHooks',
                type: 'tuple[]',
                internalType: 'struct Call[]',
                components: [
                  {
                    name: 'to',
                    type: 'address',
                    internalType: 'address',
                  },
                  {
                    name: 'value',
                    type: 'uint256',
                    internalType: 'uint256',
                  },
                  {
                    name: 'data',
                    type: 'bytes',
                    internalType: 'bytes',
                  },
                ],
              },
              {
                name: 'postHooks',
                type: 'tuple[]',
                internalType: 'struct Call[]',
                components: [
                  {
                    name: 'to',
                    type: 'address',
                    internalType: 'address',
                  },
                  {
                    name: 'value',
                    type: 'uint256',
                    internalType: 'uint256',
                  },
                  {
                    name: 'data',
                    type: 'bytes',
                    internalType: 'bytes',
                  },
                ],
              },
              {
                name: 'token',
                type: 'address',
                internalType: 'address',
              },
              {
                name: 'amount',
                type: 'uint256',
                internalType: 'uint256',
              },
              {
                name: 'adapter',
                type: 'address',
                internalType: 'contract IAdapter',
              },
              {
                name: 'adapterData',
                type: 'bytes',
                internalType: 'bytes',
              },
            ],
          },
          {
            name: 'signature',
            type: 'bytes',
            internalType: 'bytes',
          },
        ],
      },
    ],
    outputs: [
      {
        name: '',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    name: 'isModuleType',
    inputs: [
      {
        name: 'moduleTypeId',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'bool',
        internalType: 'bool',
      },
    ],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    name: 'onInstall',
    inputs: [
      {
        name: '',
        type: 'bytes',
        internalType: 'bytes',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'onUninstall',
    inputs: [
      {
        name: '',
        type: 'bytes',
        internalType: 'bytes',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'open',
    inputs: [
      {
        name: 'order',
        type: 'tuple',
        internalType: 'struct Order',
        components: [
          {
            name: 'sender',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'openDeadline',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'fillDeadline',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'initData',
            type: 'bytes',
            internalType: 'bytes',
          },
          {
            name: 'targetIntent',
            type: 'tuple',
            internalType: 'struct TargetIntent',
            components: [
              {
                name: 'nonce',
                type: 'uint256',
                internalType: 'uint256',
              },
              {
                name: 'chainId',
                type: 'uint256',
                internalType: 'uint256',
              },
              {
                name: 'token',
                type: 'address',
                internalType: 'address',
              },
              {
                name: 'amount',
                type: 'uint256',
                internalType: 'uint256',
              },
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
                  {
                    name: 'data',
                    type: 'bytes',
                    internalType: 'bytes',
                  },
                ],
              },
              {
                name: 'executions',
                type: 'tuple[]',
                internalType: 'struct ExecutionCall[]',
                components: [
                  {
                    name: 'data',
                    type: 'bytes',
                    internalType: 'bytes',
                  },
                  {
                    name: 'mode',
                    type: 'bytes32',
                    internalType: 'bytes32',
                  },
                ],
              },
            ],
          },
          {
            name: 'srcIntent',
            type: 'tuple',
            internalType: 'struct SrcIntent',
            components: [
              {
                name: 'chainId',
                type: 'uint256',
                internalType: 'uint256',
              },
              {
                name: 'nonce',
                type: 'uint256',
                internalType: 'uint256',
              },
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
                  {
                    name: 'token',
                    type: 'address',
                    internalType: 'address',
                  },
                  {
                    name: 'amount',
                    type: 'uint256',
                    internalType: 'uint256',
                  },
                ],
              },
              {
                name: 'preHooks',
                type: 'tuple[]',
                internalType: 'struct Call[]',
                components: [
                  {
                    name: 'to',
                    type: 'address',
                    internalType: 'address',
                  },
                  {
                    name: 'value',
                    type: 'uint256',
                    internalType: 'uint256',
                  },
                  {
                    name: 'data',
                    type: 'bytes',
                    internalType: 'bytes',
                  },
                ],
              },
              {
                name: 'postHooks',
                type: 'tuple[]',
                internalType: 'struct Call[]',
                components: [
                  {
                    name: 'to',
                    type: 'address',
                    internalType: 'address',
                  },
                  {
                    name: 'value',
                    type: 'uint256',
                    internalType: 'uint256',
                  },
                  {
                    name: 'data',
                    type: 'bytes',
                    internalType: 'bytes',
                  },
                ],
              },
              {
                name: 'token',
                type: 'address',
                internalType: 'address',
              },
              {
                name: 'amount',
                type: 'uint256',
                internalType: 'uint256',
              },
              {
                name: 'adapter',
                type: 'address',
                internalType: 'contract IAdapter',
              },
              {
                name: 'adapterData',
                type: 'bytes',
                internalType: 'bytes',
              },
            ],
          },
          {
            name: 'signature',
            type: 'bytes',
            internalType: 'bytes',
          },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'paymentNonce',
    inputs: [
      {
        name: '_sender',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'paymentNonce',
    inputs: [
      {
        name: '_sender',
        type: 'address',
        internalType: 'address',
      },
      {
        name: '_key',
        type: 'uint160',
        internalType: 'uint160',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'error',
    name: 'ExecutionFailed',
    inputs: [],
  },
  {
    type: 'error',
    name: 'FillFailed',
    inputs: [],
  },
  {
    type: 'error',
    name: 'InsufficientBridgeTokens',
    inputs: [],
  },
  {
    type: 'error',
    name: 'InsufficientPaymentTokens',
    inputs: [],
  },
  {
    type: 'error',
    name: 'InvalidNonce',
    inputs: [],
  },
  {
    type: 'error',
    name: 'InvalidSender',
    inputs: [
      {
        name: 'orderSender',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'initDataSender',
        type: 'address',
        internalType: 'address',
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidSignature',
    inputs: [],
  },
  {
    type: 'error',
    name: 'InvalidSrcIntent',
    inputs: [],
  },
  {
    type: 'error',
    name: 'InvalidSrcIntentIndex',
    inputs: [],
  },
  {
    type: 'error',
    name: 'OrderExpired',
    inputs: [],
  },
  {
    type: 'error',
    name: 'OrderFilled',
    inputs: [],
  },
  {
    type: 'error',
    name: 'PostHookFailed',
    inputs: [],
  },
  {
    type: 'error',
    name: 'PreHookFailed',
    inputs: [],
  },
  {
    type: 'error',
    name: 'ValidationFailed',
    inputs: [],
  },
] as const;
