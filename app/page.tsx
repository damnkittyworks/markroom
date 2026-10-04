import type { Metadata } from "next";
import { CreateReview } from "./create-review";

export const metadata: Metadata = {
  title: "Markroom — Shared PDF review",
  description: "Put one PDF in one shared review room and keep every comment together.",
};

export default function Home() {
  return <CreateReview />;
}
