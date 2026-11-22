# Krysta Launcher 1.0.9 — Rockstar Social Club (wersja testowa)

## Integracja osiągnięć Rockstar
- Dodano opcjonalne logowanie do konta Rockstar Games z ustawień integracji, w odizolowanym oknie przeglądarki, bez przechwytywania haseł przez interfejs Krysta.
- Dodano przyciski sprawdzenia połączenia, pobrania osiągnięć wybranej gry i wylogowania.
- Dodano osobną zakładkę „Osiągnięcia Rockstar” w szczegółach rozpoznanych gier, m.in. GTA V i Red Dead Redemption 2.
- Dodano pobieranie identyfikatorów zdobytych osiągnięć i czasu zdobycia z uwierzytelnionego, **nieoficjalnie udokumentowanego** interfejsu Social Club.
- Filtrowanie odpowiedzi wyklucza wpisy z `achieved: false`, będące wyłącznie częściowym postępem.
- Dane Rockstar są tylko do odczytu i nie zmieniają osiągnięć Steam ani Epic.

## Ograniczenia i testy
- Podłączenie konta wymaga zalogowania w oficjalnym oknie Rockstar i ponownego sprawdzenia połączenia w Kryście.
- Interfejs Rockstar może zmienić działanie bez zapowiedzi; połączenie i pobranie osiągnięć wymagają testu na rzeczywistym koncie i działającym Rockstar Games Launcher.
- W tej wersji wyświetlane są **identyfikatory** osiągnięć i daty, nie pełne nazwy, opisy i ikony. Dopasowanie lokalnych katalogów osiągnięć pozostaje do opracowania.
- Nie wykonano automatycznej synchronizacji w tle. Użytkownik uruchamia synchronizację ręcznie.
- Odczyt działa na Windows, a logowanie ogranicza nawigację do domen Rockstar. Zewnętrzne logowanie federacyjne może nie działać.
- To eksperymentalna integracja konta, nie oficjalne API ani potwierdzenie pełnej zgodności ze wszystkimi grami.

Dostępne są instalator Windows x64, wersja portable oraz plik SHA-256 po przejściu automatycznych testów wydania.
