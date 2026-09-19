/**
 * Design Studio route.
 * A single isolated workspace renders existing design documents as one editable stream.
 */

import { Suspense } from "react";
import DesignStudioWorkspace from "@/features/design-studio/DesignStudioWorkspace";
import "@/features/design-studio/design-studio.css";

type Props = { params: Promise<{ id: string }> };

export default async function DesignStudioPage({ params }: Props) {
  const { id } = await params;
  return (
    <Suspense fallback={<div className="sp-studio-loading"><div className="sp-spinner sp-spinner-lg" /></div>}>
      <DesignStudioWorkspace projectId={id} />
    </Suspense>
  );
}

