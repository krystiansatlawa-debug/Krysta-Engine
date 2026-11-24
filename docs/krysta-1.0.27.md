# Krysta Engine 1.0.27 — stan prac

Gałąź `krysta-1.0.27`, punkt wyjścia `aa8cabc6de627020e8b8a6dc0c9b09f01dc04525` z `main`. Raport śledzi implementację, automatyczną walidację i publikację. Testy sprzętowe są oznaczane osobno.

## Lista zadań

| Nr  | Zadanie                                       | Stan                                                                                                        |
| --- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1   | Indywidualne profile kontrolerów              | Zapis profili Xbox/XInput i DualSense oraz wybór aktywnego pada.                                            |
| 2   | Graficzne przypisywanie przycisków            | Widok układu Xbox i DualSense z edycją przypisań.                                                           |
| 3   | Zakładka Kontrolery w obu trybach             | Wspólny panel z kontrolkami właściwymi dla danego trybu.                                                    |
| 4   | Sterowanie pulpitem Windows                   | Moduł natywny działa w procesie głównym, także bez okna renderera.                                          |
| 5   | Przeciąganie plików i okien                   | Trzymanie przycisku myszy i ruch kursora do zwolnienia przycisku.                                           |
| 6   | Wznowienie sterowania po grze                 | Wstrzymanie po starcie gry, zwolnienie myszy i wznowienie po neutralnym stanie pada.                        |
| 7   | Klawiatura ekranowa poza Krystą               | Otwieranie systemowej klawiatury Windows.                                                                   |
| 8   | Kopiowanie, wklejanie i zaznaczanie           | Akcje profilu wysyłają skróty systemowe.                                                                    |
| 9   | Skrót pada do klawiatury                      | Przypisanie w panelu kontrolera.                                                                            |
| 10  | Automatyczne wysuwanie klawiatury             | Opcjonalne wykrywanie obsługiwanych pól edycji przez Windows UI Automation.                                 |
| 11  | Przełączanie ekranów padem                    | Akcja profilu wybiera kolejny wykryty wyświetlacz.                                                          |
| 12  | Przełączanie obrazu Windows                   | Windows Display Configuration zmienia aktywne wyjście.                                                      |
| 13  | Duplikowanie i rozszerzanie ekranów           | Tryby dostępne w ustawieniach i jako akcja pada.                                                            |
| 14  | Zapamiętywanie preferowanego ekranu           | Zapis identyfikatora wyświetlacza używanego w Big Picture.                                                  |
| 15  | Automatyczne przełączanie na TV w Big Picture | Opcjonalna projekcja na preferowany ekran.                                                                  |
| 16  | Powrót na monitor po zakończeniu gry          | Przywrócenie zapamiętanej konfiguracji po ostatniej śledzonej grze.                                         |
| 17  | Obsługa odłączenia TV                         | Obsługa zmiany topologii z powrotem do dostępnych ekranów.                                                  |
| 18  | Automatyczne przełączanie dźwięku HDMI        | Wybór rozpoznanego wyjścia HDMI i przywracanie poprzednich urządzeń domyślnych.                             |
| 19  | Automatyczny start modułu                     | Odczyt zapisanej konfiguracji podczas startu Krysty, również przy uruchomieniu w tle.                       |
| 20  | Praca w zasobniku                             | Moduł utrzymywany przez proces główny i przełączany z menu zasobnika Krysty.                                |
| 21  | Optymalizacja RAM i CPU                       | Wolniejsze odpytywanie bez aktywności i bez kontrolera. Odpytywanie zatrzymuje się w trakcie śledzonej gry. |
| 22  | Całkowite wyłączanie modułu                   | Zatrzymanie odpytywania, zwolnienie przycisków i zamknięcie dostępu do urządzeń.                            |
| 23  | Integracja funkcji                            | Wspólne ustawienia i obsługa cyklu aplikacji, gry oraz wyjść Windows.                                       |
| 24  | Naprawa kompilacji                            | Naprawiono konfigurację walidacji dodatku natywnego. Walidacja zintegrowanej wersji w toku.                 |
| 25  | Windows Setup EXE i Portable EXE              | Skonfigurowano budowanie i sprawdzanie obu plików na GitHub Actions.                                        |
| 26  | Stabilny Release z polskim changelogiem       | Gotowy changelog. Publikacja po pomyślnej walidacji kandydata Windows.                                      |

## Weryfikacja

- [Text Integrity dla punktu wyjścia](https://github.com/krystiansatlawa-debug/Krysta-Engine/actions/runs/45479834689) — zakończona pomyślnie.
- [Build dla punktu wyjścia](https://github.com/krystiansatlawa-debug/Krysta-Engine/actions/runs/45479834672) — kompilacje Windows i Linux zakończone pomyślnie.
- [Windows Controller Validation dla punktu wyjścia](https://github.com/krystiansatlawa-debug/Krysta-Engine/actions/runs/45479834548) — krok `cargo check` zakończył się błędem, bo nie przekazano `HYDRA_TORRENT_LIB_DIR`. Wersja 1.0.27 używa skryptu kompilacji dodatku, który przygotowuje ten katalog.
- Testy automatyczne symulują użycie pada bez otwartego okna, wstrzymanie i wznowienie po grze, zwalnianie przycisków, przypisania oraz zapis ustawień.
- Testy fizycznych kontrolerów Xbox i DualSense, klawiatury poza Krystą, przełączania obrazu i dźwięku na monitorze/TV HDMI oraz pomiary RAM i CPU — niezweryfikowane.

W profilu Xbox identyfikatorem jest gniazdo XInput. Po zmianie kolejności połączenia można ponownie wybrać aktywne gniazdo. Profile DualSense używają identyfikatora z numeru seryjnego, a gdy sterownik go nie udostępnia, ze ścieżki HID.

## Wznowienie pracy

Kandydat Windows buduje się na gałęzi `krysta-1.0.27` w workflow `krysta-release-1-0-27.yml`. Po sukcesie sprawdzić pliki i dołączyć zweryfikowany commit do `main`. Uruchomienie tego samego workflow z `main` i identyfikatorem `validated_run` publikuje artefakty kandydata po kontroli commita i sum SHA-256. Polski changelog znajduje się w `docs/krysta-1.0.27-release-notes.md`.
