import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { Providers } from "@/app/providers";
import { ChatShell } from "@/components/chat-shell";

import "./globals.css";

const geistSans = Geist({
	variable: "--font-geist-sans",
	subsets: ["latin"],
});

const geistMono = Geist_Mono({
	variable: "--font-geist-mono",
	subsets: ["latin"],
});

export const metadata: Metadata = {
	title: "NestM AI SDK Lab",
	description: "Durable multi-model agent chat and content-free AI observability for NestJS.",
	openGraph: {
		title: "NestM AI SDK Lab",
		description: "Multi-model agent chat and content-free observability for NestJS",
		type: "website",
		images: [{ url: "/og.svg", width: 1_200, height: 630, alt: "NestM AI Observability" }],
	},
	twitter: {
		card: "summary_large_image",
		title: "NestM AI SDK Lab",
		description: "Multi-model agent chat and content-free observability for NestJS",
		images: ["/og.svg"],
	},
	robots: { index: false, follow: false },
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="en">
			<body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
				<Providers>
					<ChatShell>{children}</ChatShell>
				</Providers>
			</body>
		</html>
	);
}
