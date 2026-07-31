import {
  type Address,
  type Hex,
  type StateOverride,
  encodeFunctionData,
} from 'viem';
import {
  INTEROP_EXECUTOR_ABI,
  INTEROP_EXECUTOR_SIMULATOR_ABI,
} from '@graviton/core/abis';
import { createLogger, getPublicClient, type Order } from '@graviton/core';
import { config } from '../../config/index.js';
import { getRelayerClient } from '../client.js';
import { getSimulatorAddress } from '../../constants/contracts.js';
import { INTEROP_EXECUTOR } from '../../constants/contracts.js';
import { GasEstimationResult } from '../../services/gas-estimation.service.js';

const logger = createLogger('interop-executor', config.log.level);

export class InteropExecutorContract {
  private chainId: number;

  constructor(chainId?: number) {
    this.chainId = chainId || config.blockchain.chainId;
  }

  /**
   * Call the open function to submit an order on the source chain
   * @param order - The order to open
   * @param preOpenCalls - Optional calls to batch before the open call (e.g. native ETH transfer)
   */
  async open(
    order: Order,
    preOpenCalls?: ReadonlyArray<{ to: Address; data: Hex; value?: bigint }>
  ): Promise<{ hash: Hex; receipt: any }> {
    const { kernelClient } = await getRelayerClient(order.srcIntent.chainId);
    const publicClient = getPublicClient(order.srcIntent.chainId);

    logger.info(
      { sender: order.sender, relayer: kernelClient.account?.address },
      'Opening order'
    );

    const openCall = {
      to: INTEROP_EXECUTOR as Address,
      data: encodeFunctionData({
        abi: INTEROP_EXECUTOR_ABI,
        functionName: 'open',
        args: [order],
      }),
    };

    const calls = preOpenCalls ? [...preOpenCalls, openCall] : [openCall];

    // Send transaction
    const txHash = await kernelClient.sendTransaction({ calls });

    logger.info({ txHash }, 'Transaction sent');

    // Wait for receipt
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
    });

    logger.info(
      { txHash, status: receipt.status, blockNumber: receipt.blockNumber },
      'Transaction confirmed'
    );

    return { hash: txHash, receipt };
  }

  /**
   * Call the fill function to fulfill an order on the target chain
   */
  async fill(
    order: Order,
    token: Address,
    amount: bigint
  ): Promise<{ hash: Hex; receipt: any }> {
    const { kernelClient } = await getRelayerClient(order.targetIntent.chainId);

    logger.info(
      {
        sender: order.sender,
        relayer: kernelClient.account?.address,
        amount,
      },
      'Fulfilling order'
    );

    // Send transaction
    const userOpHash = await kernelClient.sendUserOperation({
      calls: [
        {
          to: INTEROP_EXECUTOR,
          data: encodeFunctionData({
            abi: INTEROP_EXECUTOR_ABI,
            functionName: 'fill',
            args: [order, token, amount],
          }),
        },
      ],
    });

    logger.info({ userOpHash }, 'UserOperation sent');

    // Wait for receipt
    const { receipt } = await kernelClient.waitForUserOperationReceipt({
      hash: userOpHash,
    });

    logger.info(
      { userOpHash, status: receipt.status, blockNumber: receipt.blockNumber },
      'UserOperation confirmed'
    );

    return { hash: userOpHash, receipt };
  }

  /**
   * Get the hash of an order
   */
  async getOrderHash(order: Order): Promise<Hex> {
    const publicClient = getPublicClient(this.chainId);

    const hash = await publicClient.readContract({
      address: INTEROP_EXECUTOR,
      abi: INTEROP_EXECUTOR_ABI,
      functionName: 'getHash',
      args: [order],
    });

    return hash as Hex;
  }

  /**
   * Estimate gas for open transaction using simulator contract
   * @param order - The order to estimate gas for
   * @param interopExecutor - The InteropExecutor contract address
   * @param stateOverride - Optional state overrides for simulation
   * @returns Estimated gas amount
   */
  async estimateOpenGas(
    order: Order,
    interopExecutor: Address,
    stateOverride?: StateOverride
  ): Promise<GasEstimationResult> {
    const { kernelClient } = await getRelayerClient(order.srcIntent.chainId);
    const publicClient = getPublicClient(this.chainId);

    // Get the corresponding simulator address for this executor
    const simulatorAddress = getSimulatorAddress(interopExecutor);

    logger.info(
      {
        executor: interopExecutor,
        simulator: simulatorAddress,
        chainId: this.chainId,
      },
      'Estimating gas using simulator contract'
    );

    const [userOp, { maxFeePerGas, maxPriorityFeePerGas }, gasPrice] =
      await Promise.all([
        kernelClient.estimateUserOperationGas({
          calls: [
            {
              to: simulatorAddress,
              data: encodeFunctionData({
                abi: INTEROP_EXECUTOR_SIMULATOR_ABI,
                functionName: 'simulateOpen',
                args: [interopExecutor, order],
              }),
            },
          ],
          stateOverride,
        }),
        kernelClient.getUserOperationGasPrice(),
        publicClient.getGasPrice(),
      ]);

    const userOpGas =
      userOp.callGasLimit +
      userOp.preVerificationGas +
      userOp.verificationGasLimit +
      (userOp?.paymasterVerificationGasLimit || 0n) +
      (userOp?.paymasterPostOpGasLimit || 0n);
    const userOpGasPrice =
      maxFeePerGas < gasPrice + maxPriorityFeePerGas && maxFeePerGas > 0n
        ? maxFeePerGas
        : gasPrice + maxPriorityFeePerGas;

    logger.info({ gas: userOpGas.toString() }, 'Simulator gas estimated');

    return {
      gasUsed: userOpGas,
      gasCost: userOpGas * userOpGasPrice,
      gasPrice: userOpGasPrice,
    };
  }

  /**
   * Estimate gas for fill transaction
   * @param order - The order to estimate gas for
   * @param token - The token address
   * @param amount - The amount
   * @param stateOverride - Optional state overrides for simulation
   * @returns Estimated gas amount
   */
  async estimateFillGas(
    order: Order,
    token: Address,
    amount: bigint,
    stateOverride?: StateOverride
  ): Promise<GasEstimationResult> {
    const publicClient = getPublicClient(this.chainId);
    const { kernelClient } = await getRelayerClient(order.targetIntent.chainId);

    const [userOp, { maxFeePerGas, maxPriorityFeePerGas }, gasPrice] =
      await Promise.all([
        kernelClient.estimateUserOperationGas({
          calls: [
            {
              to: INTEROP_EXECUTOR,
              data: encodeFunctionData({
                abi: INTEROP_EXECUTOR_ABI,
                functionName: 'fill',
                args: [order, token, amount],
              }),
            },
          ],
          stateOverride,
        }),
        kernelClient.getUserOperationGasPrice(),
        publicClient.getGasPrice(),
      ]);

    const userOpGas =
      userOp.callGasLimit +
      userOp.preVerificationGas +
      userOp.verificationGasLimit +
      (userOp?.paymasterVerificationGasLimit || 0n) +
      (userOp?.paymasterPostOpGasLimit || 0n);
    const userOpGasPrice =
      maxFeePerGas < gasPrice + maxPriorityFeePerGas
        ? maxFeePerGas
        : gasPrice + maxPriorityFeePerGas;

    return {
      gasUsed: userOpGas,
      gasCost: userOpGas * userOpGasPrice,
      gasPrice: userOpGasPrice,
    };
  }
}
