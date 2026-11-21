# Krysta Launcher 1.0.3

Aktualizacja dla Windows x64 ogranicza obciążenie Krysty podczas rozgrywki.

- Bufor nagrań używa jednego enkodera. Miniatura jest przygotowywana przy zapisie klipu, a ustawienie bufora na 0 s pozostawia kodowanie wyłączone między nagraniami. Po obrocie włączonego bufora materiał sprzed zdarzenia narasta od początku.
- Czas gry jest zapisywany na dysk mniej więcej co 10 sekund oraz przy zamknięciu gry.
- Pobieranie aktualizacji Krysty czeka na zakończenie gry. Przerwane pobieranie zaczyna się ponownie po zamknięciu gry.
- Nakładka FPS odświeża się tylko wtedy, gdy zmienia się wyświetlana wartość.

Dostępne są instalator, wersja portable i sumy kontrolne SHA-256. Wpływ na płynność gry wymaga pomiaru na docelowym komputerze.
