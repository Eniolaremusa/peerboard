import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Peerboard",
  description: "Peer interview practice for designers",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full antialiased">{children}</body>
    </html>
  );
}
