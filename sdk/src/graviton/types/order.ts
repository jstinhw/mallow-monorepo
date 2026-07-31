import type { Address, Hex } from 'viem';

export type BridgeType = 'across' | 'cctp';

/**
 * PaymentToken struct
 * Represents a payment token to be transferred as part of the order
 */
export type PaymentToken = {
  recipient: Address;
  token: Address;
  amount: bigint;
};

/**
 * ValidationCall struct
 * Represents a validation that must be satisfied before execution
 */
export type ValidationCall = {
  validator: Address;
  data: Hex;
};

/**
 * ExecutionCall struct
 * Represents an execution call to be made after validation
 */
export type ExecutionCall = {
  data: Hex;
  mode: Hex;
};

/**
 * Call struct
 * Generic call structure for hooks
 */
export type Call = {
  to: Address;
  value: bigint;
  data: Hex;
};

/**
 * SrcIntent struct
 * Represents the source chain intent including bridge and payment details
 */
export type SrcIntent = {
  chainId: bigint;
  nonce: bigint;
  paymentTokens: PaymentToken[];
  preHooks: Call[];
  postHooks: Call[];
  token: Address;
  amount: bigint;
  adapter: Address;
  adapterData: Hex;
};

/**
 * TargetIntent struct
 * Represents the target chain intent including validations and executions
 */
export type TargetIntent = {
  nonce: bigint;
  chainId: bigint;
  token: Address;
  amount: bigint;
  validations: ValidationCall[];
  executions: ExecutionCall[];
};

/**
 * Order struct
 * Main order structure matching the Solidity InteropExecutor contract
 */
export type Order = {
  sender: Address;
  openDeadline: number;
  fillDeadline: number;
  initData: Hex;
  targetIntent: TargetIntent;
  srcIntent: SrcIntent;
  signature: Hex;
};
