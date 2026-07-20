# Local Library Sorting And Filters

Song table views keep their own sorting and filtering state under the local `twilight-echo:library-view-preferences:v1` preference key. A view is keyed by its local navigation category plus detail filter, so the all-songs table, an artist detail, an album detail, a playlist, and a folder can be configured independently.

Supported sort keys are title, artist, album, duration, format, sample rate, library-added time, and last played time. Filtering is conjunctive: lossless, DSD, sample rate, bit depth, directory, and provider selections all apply together. Empty metadata sorts before known numeric values in ascending order; source order remains stable for equal values.

`Track.addedAt` records the first time a local file is added to the library. Scanner updates retain its existing value so a metadata refresh never changes the user-visible join time. Legacy tracks without this field remain usable and sort as unknown until they are rescanned or re-added.

The view transformation runs before virtual-list slicing. Its regression suite covers combined filters, all sort fields, independent persistence, and a 10,000-track filter/sort budget.
