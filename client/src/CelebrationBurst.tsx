type Props = {
  active: boolean;
};

/* Catppuccin Mocha pastels */
const COLORS = [
  "#94e2d5",
  "#a6e3a1",
  "#fab387",
  "#f9e2af",
  "#cba6f7",
  "#f5c2e7",
  "#74c7ec",
];

export function CelebrationBurst({ active }: Props) {
  if (!active) return null;

  const pieces = Array.from({ length: 56 }, (_, i) => ({
    id: i,
    left: `${(i * 17) % 100}%`,
    delay: `${(i % 12) * 0.04}s`,
    duration: `${1.8 + (i % 5) * 0.15}s`,
    color: COLORS[i % COLORS.length],
    rotate: `${(i * 47) % 360}deg`,
    size: 6 + (i % 4) * 2,
  }));

  return (
    <div className="celebration-burst" aria-hidden>
      {pieces.map((p) => (
        <span
          key={p.id}
          className="confetti-piece"
          style={{
            left: p.left,
            animationDelay: p.delay,
            animationDuration: p.duration,
            backgroundColor: p.color,
            width: p.size,
            height: p.size * 0.6,
            transform: `rotate(${p.rotate})`,
          }}
        />
      ))}
    </div>
  );
}
