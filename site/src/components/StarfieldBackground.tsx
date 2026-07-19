import { useEffect, useRef, useState } from "react";

export default function StarfieldBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    // Check user preference for motion
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mediaQuery.matches);

    const listener = (e: MediaQueryListEvent) => {
      setReducedMotion(e.matches);
    };
    mediaQuery.addEventListener("change", listener);
    return () => mediaQuery.removeEventListener("change", listener);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    // Create stars
    const starCount = 120;
    const stars: {
      x: number;
      y: number;
      size: number;
      speed: number;
      opacity: number;
      fadeSpeed: number;
      increasing: boolean;
    }[] = [];

    for (let i = 0; i < starCount; i++) {
      stars.push({
        x: Math.random() * width,
        y: Math.random() * height,
        size: Math.random() * 1.5 + 0.2,
        speed: Math.random() * 0.05 + 0.01,
        opacity: Math.random() * 0.7 + 0.1,
        fadeSpeed: Math.random() * 0.005 + 0.002,
        increasing: Math.random() > 0.5,
      });
    }

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        width = canvas.width = entry.contentRect.width;
        height = canvas.height = entry.contentRect.height;
      }
    });
    resizeObserver.observe(canvas.parentElement || document.body);

    const render = () => {
      ctx.clearRect(0, 0, width, height);

      // Draw stars
      for (let i = 0; i < stars.length; i++) {
        const star = stars[i];

        // Slowly twinkle or slide stars
        if (!reducedMotion) {
          // Subtle float upwards
          star.y -= star.speed;
          if (star.y < 0) {
            star.y = height;
            star.x = Math.random() * width;
          }

          // Slow twinkle
          if (star.increasing) {
            star.opacity += star.fadeSpeed;
            if (star.opacity >= 0.85) star.increasing = false;
          } else {
            star.opacity -= star.fadeSpeed;
            if (star.opacity <= 0.15) star.increasing = true;
          }
        }

        ctx.fillStyle = `rgba(244, 242, 236, ${star.opacity})`;
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
        ctx.fill();
      }

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
    };
  }, [reducedMotion]);

  return (
    <canvas
      id="starfield-canvas"
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none opacity-45 mix-blend-screen"
    />
  );
}
