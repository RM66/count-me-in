import { CabinetHeader } from '@/app/cabinet/_components/cabinet-header'
import { BookingsTable } from '@/app/cabinet/bookings/_components/bookings-table'

export default function BookingsPage() {
  return (
    <>
      <CabinetHeader crumbs={[{ label: 'Cabinet', href: '/cabinet' }, { label: 'Bookings' }]} />
      <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Bookings</h1>
          <p className="text-sm text-muted-foreground">Every reservation across your services.</p>
        </div>
        <BookingsTable />
      </div>
    </>
  )
}
