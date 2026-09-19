type Props = {
  direction: "left" | "right";
};

/** Font-independent chevron used by the studio side-panel toggles. */
export default function PanelToggleIcon({ direction }: Props) {
  return (
    <svg
      className="sp-studio-panel-toggle-icon"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={direction === "left" ? "m10 4-4 4 4 4" : "m6 4 4 4-4 4"} />
    </svg>
  );
}
