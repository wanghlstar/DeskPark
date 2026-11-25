export function GomokuArt() {
  return (
    <svg viewBox="0 0 200 140" aria-hidden="true">
      <rect x="30" y="8" width="140" height="124" rx="10" fill="#d6b47d" />
      {[0, 1, 2, 3, 4].map((i) => (
        <g key={i} stroke="#856237" strokeWidth="1">
          <path d={`M 46 ${24 + i * 23} H 154 M ${54 + i * 23} 20 V 120`} />
        </g>
      ))}
      {[
        [77, 47],
        [100, 70],
        [123, 93],
      ].map(([x, y]) => (
        <circle key={x} cx={x} cy={y} r="10" fill="#242a2b" />
      ))}
      {[
        [100, 47],
        [123, 70],
      ].map(([x, y]) => (
        <circle key={x} cx={x} cy={y} r="10" fill="#fffdf9" stroke="#bcae93" />
      ))}
    </svg>
  );
}

export function ReversiArt() {
  return (
    <svg viewBox="0 0 200 140" aria-hidden="true">
      <rect
        x="37"
        y="7"
        width="126"
        height="126"
        rx="10"
        fill="#285e4e"
        stroke="#8dba94"
        strokeWidth="2"
      />
      {[0, 1, 2, 3, 4].map((i) => (
        <path
          key={i}
          d={`M 42 ${12 + i * 29} H 158 M ${42 + i * 29} 12 V 128`}
          stroke="#9cbca6"
          opacity=".35"
        />
      ))}
      {[
        [85.5, 55.5],
        [114.5, 84.5],
        [143.5, 55.5],
      ].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="11" fill="#fffdf9" />
      ))}
      {[
        [85.5, 84.5],
        [114.5, 55.5],
        [56.5, 84.5],
      ].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="11" fill="#22292b" />
      ))}
    </svg>
  );
}
