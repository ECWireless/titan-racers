import Image from "next/image";

import { PlayHome } from "@/components/play-home";

export default function Home() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-titan-black text-titan-ice">
      <Image
        priority
        src="/images/titan-racers-training-bay.png"
        alt=""
        fill
        sizes="100vw"
        className="object-cover object-[62%_50%]"
      />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(7,7,6,0.78)_0%,rgba(7,7,6,0.48)_48%,rgba(7,7,6,0.08)_86%),linear-gradient(0deg,rgba(7,7,6,0.82)_0%,rgba(7,7,6,0.18)_52%,rgba(7,7,6,0.52)_100%)]" />
      <PlayHome />
    </main>
  );
}
