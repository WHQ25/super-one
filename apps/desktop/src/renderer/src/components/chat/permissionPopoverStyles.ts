/**
 * Every harness renders the same shape of permission menu — a title row plus
 * icon/label/description rows — so the popover geometry is shared instead of each
 * selector picking its own width. Changing it here changes every harness at once.
 */
export const PERMISSION_POPOVER_CLASS = 'w-72 border-border bg-popover p-1'
