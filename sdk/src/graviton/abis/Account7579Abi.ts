export const account7579Abi = [
  {
    type: 'function',
    name: 'execute',
    inputs: [
      {
        name: 'execMode',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'execCallData',
        type: 'bytes',
        internalType: 'bytes',
      },
    ],
    outputs: [
      {
        name: 'returnData',
        type: 'bytes[]',
        internalType: 'bytes[]',
      },
    ],
    stateMutability: 'nonpayable',
  },
] as const;
