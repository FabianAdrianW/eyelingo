# SYLABUS GRAMATYCZNY — A1 + A2
**Języki:** japoński, hiszpański, angielski · **Format:** wejście do `grammar-bank.<lang>.json`

`order` = pozycja w grafie liniowym. `prereq` = warunek odblokowania.
Punkt bez `prereq` jest odblokowany od startu poziomu.

---

## JAPOŃSKI — A1 (20 punktów)

| order | id | nazwa_pl | prereq | wykładniki |
|---|---|---|---|---|
| 101 | `ja.desu` | Zdanie z „desu”: X wa Y desu | — | `desu` |
| 102 | `ja.particle_wa` | Partykuła „wa” — temat zdania | `ja.desu` | `wa` |
| 103 | `ja.desu_neg` | Przeczenie: ja arimasen | `ja.desu` | `ja arimasen`, `dewa arimasen` |
| 104 | `ja.particle_ka` | Pytanie: partykuła „ka” | `ja.desu` | `ka` |
| 105 | `ja.kosoado` | ko-so-a-do: kore / sore / are | `ja.desu` | `kore`, `sore`, `are`, `dore` |
| 106 | `ja.particle_no` | Partykuła „no” — przynależność | `ja.desu` | `no` |
| 107 | `ja.desu_past` | Czas przeszły: deshita | `ja.desu_neg` | `deshita`, `ja arimasen deshita` |
| 108 | `ja.numbers` | Liczebniki i podstawowe klasyfikatory | — | `-mai`, `-hon`, `-nin`, `-tsu` |
| 109 | `ja.arimasu_imasu` | Istnienie: arimasu / imasu | `ja.particle_wa` | `arimasu`, `imasu` |
| 110 | `ja.particle_ni_place` | Partykuła „ni” — miejsce i czas | `ja.arimasu_imasu` | `ni` |
| 111 | `ja.verb_masu` | Czasownik: forma -masu | `ja.particle_wa` | `masu` |
| 112 | `ja.particle_o` | Partykuła „o” — dopełnienie bliższe | `ja.verb_masu` | `o` |
| 113 | `ja.particle_de` | Partykuła „de” — miejsce czynności, narzędzie | `ja.verb_masu` | `de` |
| 114 | `ja.verb_masen` | Przeczenie czasownika: -masen | `ja.verb_masu` | `masen` |
| 115 | `ja.verb_mashita` | Czas przeszły czasownika: -mashita | `ja.verb_masu` | `mashita`, `masen deshita` |
| 116 | `ja.adj_i` | Przymiotniki -i (odmiana pełna) | `ja.desu` | `-i`, `-kunai`, `-katta` |
| 117 | `ja.adj_na` | Przymiotniki -na | `ja.desu` | `-na` |
| 118 | `ja.particle_to` | Partykuła „to” — i / z kimś | `ja.verb_masu` | `to` |
| 119 | `ja.verb_groups` | Grupy czasowników I / II / nieregularne | `ja.verb_masu` | — (wiedza klasyfikacyjna) |
| 120 | `ja.mashou` | Propozycja: -mashou / -masen ka | `ja.verb_masen` | `mashou`, `masen ka` |

## JAPOŃSKI — A2 (21 punktów)

| order | id | nazwa_pl | prereq | wykładniki |
|---|---|---|---|---|
| 201 | `ja.te_form` | **Forma -te — tworzenie (wszystkie grupy)** | `ja.verb_groups` | `-te`, `-de` |
| 202 | `ja.te_kudasai` | Prośba: -te kudasai | `ja.te_form` | `te kudasai` |
| 203 | `ja.te_imasu` | Czynność trwająca: -te imasu | `ja.te_form` | `te imasu` |
| 204 | `ja.te_chain` | Łączenie zdań formą -te | `ja.te_form` | `te,` |
| 205 | `ja.te_mo_ii` | Pozwolenie: -te mo ii desu ka | `ja.te_form` | `te mo ii` |
| 206 | `ja.nai_form` | Forma -nai | `ja.verb_groups` | `-nai` |
| 207 | `ja.naide_kudasai` | Prośba przecząca: -naide kudasai | `ja.nai_form`, `ja.te_kudasai` | `naide kudasai` |
| 208 | `ja.plain_form` | Forma słownikowa (plain) | `ja.verb_groups` | — |
| 209 | `ja.ta_form` | Forma -ta | `ja.plain_form` | `-ta` |
| 210 | `ja.koto_ga_dekiru` | Umiejętność: koto ga dekimasu | `ja.plain_form` | `koto ga dekimasu` |
| 211 | `ja.tai` | Chcę coś zrobić: -tai desu | `ja.verb_masu` | `tai desu` |
| 212 | `ja.hoshii` | Chcę coś: ga hoshii desu | `ja.adj_i` | `ga hoshii` |
| 213 | `ja.kara_node` | Przyczyna: kara / node | `ja.plain_form` | `kara`, `node` |
| 214 | `ja.ga_kedo` | Przeciwstawienie: ga / kedo | `ja.plain_form` | `ga`, `kedo` |
| 215 | `ja.to_omoimasu` | Opinia: to omoimasu | `ja.plain_form` | `to omoimasu` |
| 216 | `ja.yori_hou_ga` | Porównanie: yori / no hou ga | `ja.adj_i`, `ja.adj_na` | `yori`, `no hou ga` |
| 217 | `ja.ichiban` | Stopień najwyższy: ichiban | `ja.yori_hou_ga` | `ichiban` |
| 218 | `ja.ageru_morau` | Dawanie i otrzymywanie: agemasu / moraimasu | `ja.te_form` | `agemasu`, `moraimasu`, `kuremasu` |
| 219 | `ja.keigo_intro` | Rejestry grzecznościowe — wprowadzenie | `ja.te_kudasai` | `o-`, `go-`, `-masu` |
| 220 | `ja.morau_itadaku` | Forma skromna: itadakimasu | `ja.ageru_morau`, `ja.keigo_intro` | `itadakimasu` |
| 221 | **`ja.te_itadakemasen_ka`** | **Uprzejma prośba: -te + itadakemasen ka** | `ja.te_form`, `ja.te_kudasai`, `ja.morau_itadaku`, `ja.keigo_intro` | `te itadakemasen ka` |

> **Punkt 221 to struktura ze screena.** Ma cztery prerekwizyty, wszystkie z A2. Na poziomie A1 jest — zgodnie z GRAM-0 — nieosiągalna dla generatora. To jest test poprawności całego mechanizmu.

---

## HISZPAŃSKI — A1 (20 punktów)

| order | id | nazwa_pl | prereq | wykładniki |
|---|---|---|---|---|
| 101 | `es.ser` | Czasownik „ser” — odmiana i użycie | — | `soy`, `eres`, `es`, `somos`, `sois`, `son` |
| 102 | `es.gender_number` | Rodzaj i liczba rzeczownika | — | `-o/-a`, `-s/-es` |
| 103 | `es.articles` | Rodzajniki: el/la/los/las, un/una | `es.gender_number` | `el`, `la`, `un`, `una` |
| 104 | `es.adj_agreement` | Zgodność przymiotnika z rzeczownikiem | `es.gender_number` | — |
| 105 | `es.estar` | Czasownik „estar” — odmiana | `es.ser` | `estoy`, `estás`, `está` |
| 106 | `es.ser_vs_estar` | ser vs estar — rozróżnienie | `es.ser`, `es.estar` | — |
| 107 | `es.negation` | Przeczenie: no + czasownik | `es.ser` | `no` |
| 108 | `es.questions` | Pytania i słowa pytające | `es.ser` | `qué`, `dónde`, `cómo`, `cuándo`, `quién` |
| 109 | `es.pres_ar` | Czas teraźniejszy: czasowniki -ar | `es.ser` | `-o, -as, -a, -amos, -áis, -an` |
| 110 | `es.pres_er_ir` | Czas teraźniejszy: -er / -ir | `es.pres_ar` | `-o, -es, -e…` |
| 111 | `es.hay` | Konstrukcja „hay” | `es.articles` | `hay` |
| 112 | `es.possessives` | Zaimki dzierżawcze: mi, tu, su… | `es.gender_number` | `mi`, `tu`, `su`, `nuestro` |
| 113 | `es.demonstratives` | Wskazujące: este / ese / aquel | `es.gender_number` | `este`, `ese`, `aquel` |
| 114 | `es.pres_irregular` | Nieregularne teraźniejsze: tener, ir, hacer, poder, querer | `es.pres_er_ir` | `tengo`, `voy`, `hago`, `puedo`, `quiero` |
| 115 | `es.gustar` | Konstrukcja „gustar” | `es.pres_er_ir` | `me gusta`, `te gustan` |
| 116 | `es.prepositions` | Przyimki a / de / en / con | `es.pres_ar` | `a`, `de`, `en`, `con` |
| 117 | `es.ir_a_inf` | Przyszłość bliska: ir a + bezokolicznik | `es.pres_irregular` | `voy a`, `vas a` |
| 118 | `es.reflexives` | Czasowniki zwrotne | `es.pres_er_ir` | `me`, `te`, `se` |
| 119 | `es.estar_gerundio` | estar + gerundio | `es.estar` | `-ando`, `-iendo` |
| 120 | `es.muy_mucho` | muy vs mucho | `es.adj_agreement` | `muy`, `mucho` |

## HISZPAŃSKI — A2 (20 punktów)

| order | id | nazwa_pl | prereq | wykładniki |
|---|---|---|---|---|
| 201 | `es.perfecto` | Pretérito perfecto: he hablado | `es.pres_irregular` | `he`, `has`, `ha` + participio |
| 202 | `es.participio_irr` | Nieregularne imiesłowy | `es.perfecto` | `hecho`, `visto`, `escrito`, `puesto` |
| 203 | `es.indefinido_reg` | Pretérito indefinido — regularne | `es.pres_er_ir` | `-é, -aste, -ó…` |
| 204 | `es.indefinido_irr` | Pretérito indefinido — nieregularne | `es.indefinido_reg` | `fui`, `tuve`, `hice`, `estuve` |
| 205 | `es.imperfecto` | Pretérito imperfecto | `es.indefinido_reg` | `-aba`, `-ía` |
| 206 | `es.indef_vs_imperf` | indefinido vs imperfecto | `es.indefinido_irr`, `es.imperfecto` | — |
| 207 | `es.od_pronouns` | Zaimki dopełnienia bliższego | `es.pres_er_ir` | `lo`, `la`, `los`, `las` |
| 208 | `es.oi_pronouns` | Zaimki dopełnienia dalszego | `es.od_pronouns` | `le`, `les` |
| 209 | `es.pronoun_combo` | Łączenie zaimków: se lo | `es.oi_pronouns` | `se lo`, `me lo` |
| 210 | `es.comparativo` | Stopniowanie: más/menos… que | `es.adj_agreement` | `más que`, `menos que`, `tan como` |
| 211 | `es.superlativo` | Stopień najwyższy | `es.comparativo` | `el más`, `-ísimo` |
| 212 | `es.imperativo_af` | Tryb rozkazujący twierdzący | `es.pres_irregular` | `habla`, `come`, `haz`, `ven` |
| 213 | `es.futuro` | Futuro simple | `es.pres_er_ir` | `-é, -ás, -á` |
| 214 | `es.condicional` | Condicional simple | `es.futuro` | `-ía` |
| 215 | `es.por_para` | por vs para | `es.prepositions` | `por`, `para` |
| 216 | `es.perifrasis` | Peryfrazy: acabar de, volver a, empezar a | `es.ir_a_inf` | `acabo de`, `vuelvo a` |
| 217 | `es.hace_tiempo` | Wyrażenia czasu: hace / desde hace | `es.indefinido_reg` | `hace`, `desde hace` |
| 218 | `es.subordinada_que` | Zdania podrzędne z „que” | `es.pres_er_ir` | `que` |
| 219 | `es.subj_intro` | Tryb łączący — wprowadzenie (querer que, ojalá) | `es.subordinada_que`, `es.imperativo_af` | `quiero que`, `ojalá` |
| 220 | `es.imperativo_neg` | Tryb rozkazujący przeczący | `es.subj_intro` | `no hables`, `no hagas` |

---

## ANGIELSKI — A1 (18 punktów)

| order | id | nazwa_pl | prereq | wykładniki |
|---|---|---|---|---|
| 101 | `en.to_be` | Czasownik „to be” | — | `am`, `is`, `are` |
| 102 | `en.pronouns` | Zaimki osobowe i dzierżawcze | `en.to_be` | `I`, `my`, `his` |
| 103 | `en.articles` | Rodzajniki a / an / the | `en.to_be` | `a`, `an`, `the` |
| 104 | `en.plurals` | Liczba mnoga rzeczowników | `en.articles` | `-s`, `-es`, formy nieregularne |
| 105 | `en.possessive_s` | Dopełniacz saksoński | `en.plurals` | `'s`, `'` |
| 106 | `en.there_is` | there is / there are | `en.plurals` | `there is`, `there are` |
| 107 | `en.have_got` | have got | `en.to_be` | `have got`, `has got` |
| 108 | `en.present_simple` | Present Simple — twierdzenie | `en.pronouns` | `-s` w 3. os. l. poj. |
| 109 | `en.ps_questions` | Present Simple — pytania i przeczenia (do/does) | `en.present_simple` | `do`, `does`, `don't`, `doesn't` |
| 110 | `en.adv_frequency` | Przysłówki częstotliwości i ich miejsce w zdaniu | `en.present_simple` | `always`, `usually`, `never` |
| 111 | `en.can` | Czasownik modalny „can” | `en.present_simple` | `can`, `can't` |
| 112 | `en.imperative` | Tryb rozkazujący | `en.present_simple` | — |
| 113 | `en.prep_time_place` | Przyimki czasu i miejsca: in / on / at | `en.present_simple` | `in`, `on`, `at` |
| 114 | `en.present_cont` | Present Continuous | `en.to_be` | `am/is/are + -ing` |
| 115 | `en.ps_vs_pc` | Present Simple vs Continuous | `en.present_cont`, `en.ps_questions` | — |
| 116 | `en.was_were` | Czas przeszły „to be” | `en.to_be` | `was`, `were` |
| 117 | `en.some_any` | some / any | `en.plurals` | `some`, `any` |
| 118 | `en.would_like` | would like | `en.can` | `would like`, `'d like` |

## ANGIELSKI — A2 (19 punktów)

| order | id | nazwa_pl | prereq | wykładniki |
|---|---|---|---|---|
| 201 | `en.past_simple_reg` | Past Simple — czasowniki regularne | `en.was_were` | `-ed` |
| 202 | `en.past_simple_irr` | Past Simple — czasowniki nieregularne | `en.past_simple_reg` | `went`, `saw`, `made` |
| 203 | `en.past_questions` | Past Simple — pytania i przeczenia (did) | `en.past_simple_irr` | `did`, `didn't` |
| 204 | `en.countable` | Rzeczowniki policzalne i niepoliczalne | `en.some_any` | `much`, `many`, `a lot of` |
| 205 | `en.comparatives` | Stopień wyższy przymiotnika | `en.articles` | `-er`, `more` |
| 206 | `en.superlatives` | Stopień najwyższy | `en.comparatives` | `-est`, `the most` |
| 207 | `en.going_to` | be going to | `en.present_cont` | `going to` |
| 208 | `en.will` | will | `en.going_to` | `will`, `won't` |
| 209 | `en.will_vs_going_to` | will vs going to | `en.will` | — |
| 210 | `en.past_cont` | Past Continuous | `en.was_were`, `en.present_cont` | `was/were + -ing` |
| 211 | `en.past_cont_vs_simple` | Past Continuous vs Past Simple (when/while) | `en.past_cont`, `en.past_questions` | `when`, `while` |
| 212 | `en.present_perfect` | Present Perfect — forma i użycie | `en.past_simple_irr` | `have/has + past participle` |
| 213 | `en.pp_adverbs` | ever / never / just / already / yet | `en.present_perfect` | `ever`, `just`, `yet` |
| 214 | `en.pp_vs_past` | Present Perfect vs Past Simple | `en.pp_adverbs`, `en.past_questions` | — |
| 215 | `en.modals_obligation` | should / must / have to | `en.can` | `should`, `must`, `have to` |
| 216 | `en.zero_first_cond` | Okres warunkowy 0 i I | `en.will` | `if + present, will` |
| 217 | `en.verb_patterns` | Czasownik + bezokolicznik / + -ing | `en.present_simple` | `want to`, `enjoy -ing` |
| 218 | `en.used_to` | used to | `en.past_simple_irr` | `used to` |
| 219 | `en.relative_clauses` | Zdania względne: who / which / that | `en.present_simple` | `who`, `which`, `that` |

---

## Podsumowanie objętości

| Język | A1 | A2 | Razem (partia 1) |
|---|---|---|---|
| japoński | 20 | 21 | 41 |
| hiszpański | 20 | 20 | 40 |
| angielski | 18 | 19 | 37 |
| **Suma** | **58** | **60** | **118** |

Projekcja docelowa: ~130 punktów na język (A1–C1) × 13 języków ≈ **1 700 wpisów**.
