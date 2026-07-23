import { MoreHorizontalIcon } from 'lucide-react'
import { CabinetHeader } from '@/app/cabinet/_components/cabinet-header'
import { AddSlotDialog } from '@/app/cabinet/slots/_components/add-slot-dialog'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  slots,
  getService,
  seatsLeft,
  fillLabel,
  formatDate,
  formatTime,
  slotPrice,
} from '@/lib/mock-data'

const fillVariant: Record<
  ReturnType<typeof fillLabel>,
  { label: string; variant: 'secondary' | 'outline' | 'default' }
> = {
  open: { label: 'Open', variant: 'outline' },
  filling: { label: 'Filling up', variant: 'default' },
  full: { label: 'Full', variant: 'secondary' },
}

export default function SlotsPage() {
  const sorted = [...slots].sort((a, b) => a.startsAt.localeCompare(b.startsAt))

  return (
    <>
      <CabinetHeader
        crumbs={[{ label: 'Cabinet', href: '/cabinet' }, { label: 'Slots' }]}
        action={<AddSlotDialog />}
      />
      <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Slots</h1>
          <p className="text-sm text-muted-foreground">
            Schedule and track capacity for every session.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Upcoming schedule</CardTitle>
            <CardDescription>{sorted.length} slots over the next 7 days.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Service</TableHead>
                  <TableHead>Date &amp; time</TableHead>
                  <TableHead>Capacity</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((slot) => {
                  const svc = getService(slot.serviceId)
                  const left = seatsLeft(slot)
                  const pct = Math.round((slot.bookedCount / slot.capacity) * 100)
                  const fill = fillVariant[fillLabel(slot)]
                  return (
                    <TableRow key={slot.id}>
                      <TableCell className="font-medium">{svc?.title}</TableCell>
                      <TableCell className="text-muted-foreground">
                        <div className="flex flex-col">
                          <span>{formatDate(slot.startsAt)}</span>
                          <span className="text-xs">
                            {formatTime(slot.startsAt)} · {slot.durationMinutes} min
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex w-32 flex-col gap-1">
                          <span className="text-xs text-muted-foreground">
                            {slot.bookedCount}/{slot.capacity} · {left} left
                          </span>
                          <Progress value={pct} />
                        </div>
                      </TableCell>
                      <TableCell>{slotPrice(slot)}</TableCell>
                      <TableCell>
                        <Badge variant={fill.variant}>{fill.label}</Badge>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="size-8">
                              <MoreHorizontalIcon />
                              <span className="sr-only">Slot actions</span>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuGroup>
                              <DropdownMenuItem>Edit slot</DropdownMenuItem>
                              <DropdownMenuItem>View bookings</DropdownMenuItem>
                              <DropdownMenuItem>Duplicate</DropdownMenuItem>
                              <DropdownMenuItem variant="destructive">
                                Cancel slot
                              </DropdownMenuItem>
                            </DropdownMenuGroup>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
