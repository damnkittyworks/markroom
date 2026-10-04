import type { Metadata } from "next";
import { EmbedReviewRoom } from "../../embed-review-room";

export const metadata: Metadata = {
  title: "Shared review room — Markroom",
  description: "Review one shared PDF together.",
};

export default async function NativeReviewPage({
  params,
}: {
  params: Promise<{ reviewId: string }>;
}) {
  const { reviewId } = await params;
  return <EmbedReviewRoom reviewId={reviewId} />;
}
