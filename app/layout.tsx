import type { Metadata } from "next";
import "./globals.css";
import "./profile.css";

export const metadata: Metadata = {
  title: "Job Match Agent",
  description: "Read job alerts from Gmail and rank them against a personal career profile.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
