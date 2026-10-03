---
'@geekmidas/testkit': minor
---

:sparkles: `faker.age(min, max?)` returns a birthdate for someone of that age today

`faker.age(18)` is someone exactly 18; `faker.age(18, 24)` is someone aged 18 to 24 inclusive. It goes through faker's `date.birthdate`, so a seeded faker repeats it. An impossible range (negative, or oldest below youngest) throws `AgeRangeInvalid`.
