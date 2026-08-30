import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Job Match Agent",
  description: "Read job alerts from Gmail and rank them against a career profile.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
