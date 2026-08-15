const countdown = document.querySelector("[data-countdown]");
const countdownValue = document.querySelector("[data-countdown-value]");
const phaseStatus = document.querySelector("[data-phase-status]");

function countdownParts(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${days}D · ${String(hours).padStart(2, "0")}H · ${String(minutes).padStart(2, "0")}M · ${String(seconds).padStart(2, "0")}S`;
}

function updateCountdown() {
  if (!countdown || !countdownValue) return;
  const now = Date.now();
  const start = Date.parse(countdown.dataset.start || "");
  const label = countdown.querySelector(".mint-clock-label");

  if (!Number.isFinite(start)) return;

  if (now < start) {
    if (phaseStatus) phaseStatus.textContent = "GTD PHASE IS OPEN";
    if (label) label.textContent = "PUBLIC MINT OPENS IN";
    countdownValue.textContent = countdownParts(start - now);
    countdown.classList.remove("is-live");
    return;
  }

  if (phaseStatus) phaseStatus.textContent = "PUBLIC MINT IS OPEN";
  if (label) label.textContent = "MINT STATUS";
  countdownValue.textContent = "LIVE NOW";
  countdown.classList.add("is-live");
}

updateCountdown();
setInterval(updateCountdown, 1000);

const copyButton = document.querySelector("[data-copy-contract]");
const contract = document.querySelector("[data-contract]");
copyButton?.addEventListener("click", async () => {
  if (!contract) return;
  try {
    await navigator.clipboard.writeText(contract.textContent.trim());
    copyButton.textContent = "Copied";
    setTimeout(() => {
      copyButton.textContent = "Copy contract";
    }, 1800);
  } catch {
    copyButton.textContent = "Select the address";
  }
});

document.querySelectorAll("[data-year]").forEach((element) => {
  element.textContent = String(new Date().getFullYear());
});

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const reveals = document.querySelectorAll(".reveal");
if (reducedMotion || !("IntersectionObserver" in window)) {
  reveals.forEach((element) => element.classList.add("is-visible"));
} else {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    },
    { rootMargin: "0px 0px -8%", threshold: 0.12 },
  );
  reveals.forEach((element) => observer.observe(element));
}

const header = document.querySelector("[data-header]");
window.addEventListener(
  "scroll",
  () => header?.classList.toggle("is-scrolled", window.scrollY > 24),
  { passive: true },
);
