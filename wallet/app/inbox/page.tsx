"use client";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { WalletPageShell } from "@/components/WalletPageShell";
import { QueueScreen } from "@/components/screens/QueueScreen";
import { TxReviewScreen } from "@/components/screens/TxReviewScreen";
import { useApprovalQueue } from "@/hooks/useApprovalQueue";

function InboxPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { byId } = useApprovalQueue();
  const openItemId = searchParams.get("item");

  const opened = openItemId ? byId(openItemId) : undefined;

  return (
    <WalletPageShell route="inbox" eyebrow="Inbox" title="Inbox">
      {opened ? (
        <TxReviewScreen
          item={opened}
          onClose={() => {
            router.push("/inbox");
          }}
        />
      ) : (
        <QueueScreen onOpenItem={(id) => router.push(`/inbox?item=${encodeURIComponent(id)}`)} />
      )}
    </WalletPageShell>
  );
}

export default function Page() {
  return (
    <Suspense>
      <InboxPageContent />
    </Suspense>
  );
}
