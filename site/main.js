const countdown = document.querySelector("[data-countdown]");
const countdownValue = document.querySelector("[data-countdown-value]");
const phaseStatus = document.querySelector("[data-phase-status]");

if (countdown && countdownValue) {
  const label = countdown.querySelector(".mint-clock-label");
  if (phaseStatus) phaseStatus.textContent = "SOLD OUT";
  if (label) label.textContent = "FINAL CIRCULATING SUPPLY";
  countdownValue.textContent = "4,295";
  countdown.classList.remove("is-live");
}

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
