"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Authenticated, Unauthenticated, AuthLoading } from "convex/react";
import { SignInButton, SignUpButton } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import {
  HashIcon,
  ChatCircleIcon,
  ShieldCheckIcon,
  SparkleIcon,
  UsersIcon,
  MicrophoneIcon,
} from "@phosphor-icons/react";

const FEATURES = [
  {
    icon: MicrophoneIcon,
    title: "Voice channels that just work",
    description:
      "Drop into a voice channel with one click and start talking — crisp, low-latency audio with everyone in the room.",
  },
  {
    icon: UsersIcon,
    title: "Servers, categories & channels",
    description:
      "Spin up a server in seconds, organize it with categories, and mix voice and text channels however you like.",
  },
  {
    icon: ShieldCheckIcon,
    title: "Custom roles & permissions",
    description:
      "Create roles with fine-grained permissions — manage channels, manage messages, kick, ban, and more — with a proper role hierarchy.",
  },
  {
    icon: ChatCircleIcon,
    title: "Friends & direct messages",
    description:
      "Add friends by username and jump straight into a 1:1 conversation, realtime, no refresh required.",
  },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-kumo-base text-kumo-default">
      <AuthLoading>
        <div className="flex min-h-screen items-center justify-center">
          <p className="text-sm text-kumo-subtle">Loading…</p>
        </div>
      </AuthLoading>
      <Authenticated>
        <RedirectToApp />
      </Authenticated>
      <Unauthenticated>
        <LandingPage />
      </Unauthenticated>
    </main>
  );
}

function LandingPage() {
  return (
    <>
      <NavBar />
      <Hero />
      <Features />
      <BottomCta />
      <Footer />
    </>
  );
}

function NavBar() {
  return (
    <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
      <div className="flex items-center gap-2 font-extrabold tracking-tight">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-kumo-brand text-white">
          <HashIcon className="h-5 w-5" />
        </div>
        Outpost
      </div>
      <div className="flex items-center gap-2">
        <SignInButton mode="modal">
          <Button variant="ghost">Sign in</Button>
        </SignInButton>
        <SignUpButton mode="modal">
          <Button>Create an account</Button>
        </SignUpButton>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-40 -z-10 flex justify-center blur-3xl"
      >
        <div className="h-[420px] w-[720px] rounded-full bg-kumo-brand/25" />
      </div>
      <div className="mx-auto flex max-w-4xl flex-col items-center gap-6 px-6 pb-24 pt-16 text-center">
        <span className="rounded-full border border-kumo-line bg-kumo-elevated px-4 py-1 text-xs font-medium text-kumo-subtle">
          Voice chat for your community
        </span>
        <h1 className="text-5xl font-black tracking-tight text-balance sm:text-6xl">
          Hop in, talk,
          <br />
          <span className="text-kumo-brand">no friction.</span>
        </h1>
        <p className="max-w-xl text-lg text-kumo-subtle text-balance">
          Outpost is a fast voice chat platform for your community — jump
          into a voice channel with one click, plus servers, roles &amp;
          permissions, text channels, friends, and DMs, all realtime.
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
          <SignUpButton mode="modal">
            <Button size="lg" className="text-base">
              Create an account
            </Button>
          </SignUpButton>
          <SignInButton mode="modal">
            <Button size="lg" variant="secondary" className="text-base">
              Sign in
            </Button>
          </SignInButton>
        </div>
      </div>
    </section>
  );
}

function Features() {
  return (
    <section className="mx-auto max-w-6xl px-6 pb-24">
      <div className="grid gap-4 sm:grid-cols-2">
        {FEATURES.map((feature) => (
          <div
            key={feature.title}
            className="flex flex-col gap-3 rounded-2xl border border-kumo-line bg-kumo-elevated p-6"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-kumo-brand/15 text-kumo-brand">
              <feature.icon className="h-5 w-5" />
            </div>
            <h3 className="font-semibold">{feature.title}</h3>
            <p className="text-sm text-kumo-subtle">{feature.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function BottomCta() {
  return (
    <section className="mx-auto max-w-4xl px-6 pb-24">
      <div className="flex flex-col items-center gap-4 rounded-3xl border border-kumo-line bg-kumo-elevated px-8 py-12 text-center">
        <SparkleIcon className="h-8 w-8 text-kumo-brand" />
        <h2 className="text-3xl font-bold tracking-tight">
          Your community is waiting.
        </h2>
        <p className="max-w-md text-kumo-subtle">
          Create your first server and invite your friends in under a minute.
        </p>
        <SignUpButton mode="modal">
          <Button size="lg" className="text-base">
            Get started — it&apos;s free
          </Button>
        </SignUpButton>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-kumo-line">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 py-8 text-sm text-kumo-subtle sm:flex-row">
        <span>© {new Date().getFullYear()} Outpost</span>
        <Link href="/app" className="hover:text-kumo-default">
          Go to app
        </Link>
      </div>
    </footer>
  );
}

function RedirectToApp() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/app");
  }, [router]);
  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-sm text-kumo-subtle">Taking you to the app…</p>
    </div>
  );
}
