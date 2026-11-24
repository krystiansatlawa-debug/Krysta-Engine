# Krysta Engine 1.0.27 — stan prac

Gałąź `krysta-1.0.27`, punkt wyjścia `aa8cabc6de627020e8b8a6dc0c9b09f01dc04525` z `main`. Raport śledzi implementację, automatyczną walidację i publikację. Testy sprzętowe są oznaczane osobno.

## Lista zadań

| Nr | Zadanie | Stan na początku pracy |
| --- | --- | --- |
| 1 | Indywidualne profile kontrolerów | Częściowo. Profile istnieją w Big Picture. |
| 2 | Graficzne przypisywanie przycisków | Częściowo. Przypisania istnieją w Big Picture. |
| 3 | Zakładka Kontrolery w obu trybach | Zakładka istnieje w Big Picture. |
| 4 | Sterowanie pulpitem Windows | Częściowo. Moduł XInput w tle przesuwa kursor. |
| 5 | Przeciąganie plików i okien | Częściowo. Przytrzymanie myszy działało z renderera Big Picture. |
| 6 | Wznowienie sterowania po grze | Częściowo. Moduł kursora w tle zna stan śledzonych gier. |
| 7 | Klawiatura ekranowa poza Krystą | Do wykonania. |
| 8 | Kopiowanie, wklejanie i zaznaczanie | Do podłączenia w trybie pulpitu. |
| 9 | Skrót pada do klawiatury | Do podłączenia w trybie pulpitu. |
| 10 | Automatyczne wysuwanie klawiatury | Do wykonania poza aplikacją. |
| 11 | Przełączanie ekranów padem | Do wykonania. |
| 12 | Przełączanie obrazu Windows | Istnieje przenoszenie okna Krysty między aktywnymi ekranami. |
| 13 | Duplikowanie i rozszerzanie ekranów | Do wykonania. |
| 14 | Zapamiętywanie preferowanego ekranu | Do wykonania. |
| 15 | Automatyczne przełączanie na TV w Big Picture | Do wykonania. |
| 16 | Powrót na monitor po zakończeniu gry | Do wykonania. |
| 17 | Obsługa odłączenia TV | Do wykonania. |
| 18 | Automatyczne przełączanie dźwięku HDMI | Do wykonania. |
| 19 | Automatyczny start modułu | Do podłączenia do uruchamiania Krysty. |
| 20 | Praca w zasobniku | Krysta ma zasobnik. Moduł wymaga integracji. |
| 21 | Optymalizacja RAM i CPU | Do ograniczenia odpytywanie bez aktywnego pada. |
| 22 | Całkowite wyłączanie modułu | Do połączenia z trwałym ustawieniem i zwalnianiem zasobów. |
| 23 | Integracja funkcji | W toku. |
| 24 | Naprawa kompilacji | Walidacja kodu bazowego w toku. |
| 25 | Windows Setup EXE i Portable EXE | Istnieje ścieżka pakowania. Wymagana kompilacja 1.0.27. |
| 26 | Stabilny Release z polskim changelogiem | Oczekuje na walidację. |

## Weryfikacja

- [Text Integrity dla punktu wyjścia](https://github.com/krystiansatlawa-debug/Krysta-Engine/actions/runs/45479834689) — zakończona pomyślnie.
- [Windows Controller Validation dla punktu wyjścia](https://github.com/krystiansatlawa-debug/Krysta-Engine/actions/runs/45479834548) oraz [Build dla punktu wyjścia](https://github.com/krystiansatlawa-debug/Krysta-Engine/actions/runs/45479834672) — uruchomione.
- Fizyczne kontrolery Xbox i DualSense, monitor/TV HDMI oraz rzeczywiste zużycie RAM i CPU — niezweryfikowane.

## Wznowienie pracy

Kontynuować na gałęzi `krysta-1.0.27`. Po aktualizacji kodu uzupełnić tabelę i wyniki weryfikacji. Opublikować stabilne `v1.0.27` po pomyślnej walidacji tego samego commita, z instalatorem, wersją portable i sumami SHA-256.
