import { Suspense } from "react";
import { Exchange } from "./exchange";

async function Resolve({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return <Exchange sessionId={sessionId} />;
}

export default function IntakeExchangePage({ params }: { params: Promise<{ sessionId: string }> }) {
  return (
    <Suspense fallback={<p className="py-20 text-center text-lg text-ink-500">Menyiapkan sesi…</p>}>
      <Resolve params={params} />
    </Suspense>
  );
}
