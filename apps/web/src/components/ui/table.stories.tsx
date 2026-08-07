import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

const meta = {
  title: 'UI/Table',
  component: Table,
  tags: ['autodocs'],
} satisfies Meta<typeof Table>

export default meta
type Story = StoryObj<typeof meta>

const bookings = [
  { guest: 'Anna K.', slot: 'Sat 10:00', spots: 2, status: 'confirmed' },
  { guest: 'Ivan P.', slot: 'Sat 10:00', spots: 1, status: 'confirmed' },
  { guest: 'Maria S.', slot: 'Sun 12:00', spots: 3, status: 'cancelled' },
]

export const Default: Story = {
  render: () => (
    <Table>
      <TableCaption>Recent bookings for Yoga class.</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Guest</TableHead>
          <TableHead>Slot</TableHead>
          <TableHead>Spots</TableHead>
          <TableHead className="text-right">Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {bookings.map((booking) => (
          <TableRow key={booking.guest}>
            <TableCell className="font-medium">{booking.guest}</TableCell>
            <TableCell>{booking.slot}</TableCell>
            <TableCell>{booking.spots}</TableCell>
            <TableCell className="text-right">
              <Badge variant={booking.status === 'confirmed' ? 'secondary' : 'destructive'}>
                {booking.status}
              </Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell colSpan={2}>Total spots</TableCell>
          <TableCell colSpan={2}>6</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  ),
}
