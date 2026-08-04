import {
  Dumbbell,
  Flower2,
  GraduationCap,
  PawPrint,
  Sparkles,
  Tent,
  Users2,
} from 'lucide-react'

// Audience categories mirror the "Target audience" list in README.md.
// Kept broad on purpose: the product spans many niches, and a visitor should
// recognize their own use case here rather than infer it from a single hero image.
const audiences = [
  {
    icon: Dumbbell,
    title: 'Sport & active recreation',
    examples: 'Group training, dance, martial arts, running & climbing clubs, SUP and ski.',
  },
  {
    icon: Flower2,
    title: 'Wellness & practices',
    examples: 'Meditation, breathwork, sound healing, bath ceremonies, retreats, support groups.',
  },
  {
    icon: GraduationCap,
    title: 'Learning & creativity',
    examples: 'Masterclasses, courses, art & ceramics, photography, cooking, music, language clubs.',
  },
  {
    icon: Users2,
    title: 'Entertainment & communities',
    examples: 'Quizzes, mafia, board & RPG games, book clubs, networking, kids’ events, meetups.',
  },
  {
    icon: Tent,
    title: 'Excursions & outings',
    examples: 'City walks, food tours, hiking, camping, diving, fishing, yachting, gastro tours.',
  },
  {
    icon: PawPrint,
    title: 'Animals',
    examples: 'Cynologist sessions, dog socialization & training, horseback, pet-friendly events.',
  },
  {
    icon: Sparkles,
    title: 'Beauty & professional services',
    examples: 'Group beauty procedures, makeup lessons, consultations, coworking, masterminds.',
  },
]

export function Audiences() {
  return (
    <section id="who-its-for" className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          Made for anyone who runs group events
        </h2>
        <p className="mt-4 text-muted-foreground text-pretty">
          If people gather at a set time and space is limited, CountMeIn keeps your bookings in
          order — whatever you organize.
        </p>
      </div>

      <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {audiences.map((a) => (
          <li key={a.title} className="flex gap-4 rounded-xl border p-5">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <a.icon className="size-5" />
            </span>
            <div className="flex flex-col gap-1">
              <h3 className="font-medium">{a.title}</h3>
              <p className="text-sm text-muted-foreground text-pretty">{a.examples}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
