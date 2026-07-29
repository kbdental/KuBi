# The design principle

> KuBi should feel less like completing tasks and more like running a clinic.
> Every screen should reinforce where the clinic is in its day, not just what
> an individual needs to click next.
>
> — Owner, VS-01 usability review

This governs every screen from here. It is not a style note; it changes what a
screen is allowed to be.

## What it rules out

A screen that only answers "what should I click next" is incomplete, even if it
answers that well. The first version of Today was exactly that: a correct,
well-ordered task list that never once said where the clinic was, what phase
the morning was in, or whether anything was late. It was not wrong. It was
answering a smaller question than the one a person actually has.

## The question to design against

Not *which screen does Priya open* — that leads to optimising screens, and a
screen can be excellent while the morning it belongs to is a mess.

**What does Priya do between 9:00 and 10:00?**

She arrives, sees where things stand, does the thing in front of her, hits
something that is not right, hands it to someone who can fix it, and gets on.
A design that starts from that hour puts the clinic first and the task second,
because that is the order she experiences them in.

## What it asks of every screen

1. **Say where the clinic is before saying what one person owes.** Clinic,
   time, phase, readiness, time remaining. Whoever is looking, the times are
   the *clinic's* — a manager checking from home reads clinic time.
2. **One thing in front of you, not a menu.** The work happening now is open
   when you arrive. Choosing between tasks is overhead, not work.
3. **Every tap should mean something.** Ticks are work — a person asserting
   something is true — and are never collapsed for speed. Overhead taps are
   fair game and should go.
4. **Progress belongs to the clinic, not the person.** "3 of 5 areas ready" is
   a fact about the morning. One person finishing their own share is not.
5. **Never imply a state you have not got.** No opening set today is not
   "ready". An unknown requirement is not a pass. No appointment data is not a
   guessed first-patient time — the line is absent instead.

## The standing test

Before adding a screen or a field, ask what it tells someone about **where the
clinic is in its day**. If the honest answer is "nothing, but it tells one
person what to click", it is not finished yet.
