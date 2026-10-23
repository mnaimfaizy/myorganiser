/**
 * The one field surface shared by Input, Textarea and the Select trigger (Web v2.0, DESIGN.md
 * "Inputs & VaultGate"). Kept out of the component file so the two controls
 * cannot drift apart, and not exported through the barrel: it is a private
 * detail of the field, not part of the public UI surface.
 *
 * The edge is 1px of control-edge at rest and 2px of focus or error-edge in
 * the focus and error states. It is drawn as a 1px border plus a 1px inset
 * ring of the same colour, so the thickening never shifts the layout.
 *
 * The error variant is stacked (`aria-invalid` + `focus`) so it outranks the
 * plain focus rule when a field is both focused and invalid.
 */
export const fieldBaseClassName = [
  'w-full rounded-control border border-control-edge bg-raised-surface px-3.5',
  'text-foreground placeholder:text-muted-foreground',
  'focus:border-focus focus:ring-1 focus:ring-inset focus:ring-focus focus:outline-none',
  'aria-[invalid=true]:border-error-edge aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-inset aria-[invalid=true]:ring-error-edge',
  'aria-[invalid=true]:focus:border-error-edge aria-[invalid=true]:focus:ring-error-edge',
  'disabled:cursor-not-allowed disabled:border-border-strong disabled:bg-subtle disabled:text-muted-foreground',
].join(' ');
