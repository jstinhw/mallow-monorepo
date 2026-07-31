// Note: This is a copied version of the poll function from viem
// https://github.com/wevm/viem/blob/aca3e1d75d979aa50f5737a2fabaf0088b160f46/src/utils/poll.ts

export async function wait(time: number) {
  return new Promise((res) => setTimeout(res, time));
}

type PollOptions<data> = {
  // Whether or not to emit when the polling starts.
  emitOnBegin?: boolean | undefined;
  // The initial wait time (in ms) before polling.
  initialWaitTime?: ((data: data | undefined) => Promise<number>) | undefined;
  // The interval (in ms).
  interval: number;
};

/**
 * @description Polls a function at a specified interval.
 */
export function poll<data>(
  fn: ({ unpoll }: { unpoll: () => void }) => Promise<data | undefined>,
  { emitOnBegin, initialWaitTime, interval }: PollOptions<data>,
) {
  let active = true;

  const unwatch = () => (active = false);

  const watch = async () => {
    let data: data | undefined;
    if (emitOnBegin) data = await fn({ unpoll: unwatch });

    const initialWait = (await initialWaitTime?.(data)) ?? interval;
    await wait(initialWait);

    const poll = async () => {
      if (!active) return;
      await fn({ unpoll: unwatch });
      await wait(interval);
      poll();
    };

    poll();
  };
  watch();

  return unwatch;
}
