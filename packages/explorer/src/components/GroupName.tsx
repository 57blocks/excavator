/** A group's displayed name: the translated label, then " \u00b7 " and the qualifier (a file path, never translated) in mono. */
export default function GroupName({ label, qualifier }: { label: string; qualifier?: string | null }) {
  return (
    <>
      {label}
      {qualifier ? (
        <>
          {" \u00b7 "}
          <span className="font-mono normal-case">{qualifier}</span>
        </>
      ) : null}
    </>
  );
}
