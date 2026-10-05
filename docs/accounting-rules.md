# Könyvelési szabályok – megvalósítás (terv 2–4. pont)

A szabályok forrása a jóváhagyott terv. Ez a lap azt rögzíti, hol él egy-egy szabály a kódban, és mi ellenőrzi.

**Kettős megvalósítás, egy igazság.** A főbb szabályok kétszer vannak megírva, mindkét oldalon ugyanazokkal a közös tesztesetekkel (`tests/fixtures/*.json`):

| Szabály | TypeScript | SQL (adatbázis) | Közös esetek |
|---|---|---|---|
| Eseménytípusok alakja (terv 2.) | `validateEvent()` – `src/lib/finance/ledger.ts` | `private.event_errors()` – halasztott ellenőrző | `event-validation-cases.json` (14 érvényes, 12 hibás) |
| Devizaárfolyam-kiválasztás (3.1) | `selectFx()` – `fx.ts` | `public.select_fx()` | `fx-selection-cases.json` (12 eset) |
| Ár-kiválasztás (3.3) | `selectPrice()` – `prices.ts` | `public.select_price()` | `price-selection-cases.json` (13 eset) |

## Események és tételek

- **Esemény és tételei:** egy esemény (`events`) tételekből (`lines`) áll. Egy tétel vagy egy eszköz darabszámát változtatja egy számlán (`position`), vagy egy deviza cash-egyenlegét (`cash`).
- **Atomi rögzítés:** a rögzítés a `public.record_event()` függvénnyel történik, egy tranzakcióban.
- **Commit előtti ellenőrzés:** a halasztott ellenőrző (`check_event` constraint trigger) minden eseményt és tételt a commit előtt vizsgál. Így az API-n keresztül közvetlenül sem lehet hibás eseményt menteni.
- **Előzmény-ellenőrzés az adatbázisban:**
  - egy pozíció darabszáma a sorrendben (nap, rögzítés ideje) sosem mehet nulla alá;
  - a split tétel darabszáma = korábbi darab × (arány − 1).
  - Ezért egy olyan vétel sem törölhető, amelyre későbbi eladás épül.
- **Napló:** az intézmények, számlák, eszközök, események és tételek minden változása az `audit_log`-ba kerül.

## Lotok és eredmény

- **FIFO:** a lotokat a `runLedger()` építi. Minden lot őrzi a vétel napját, az egységárat és a vételkori devizaárfolyam-hivatkozásokat (`cost_fx_refs`, terv 3.2). Eladáskor és átvezetéskor a lezárt lotrészek ezeket viszik tovább.
- **Realizált eredmény** = bevétel − díj − a felhasznált lotok bekerülési értéke, az eszköz devizájában.
  - Ha egy díj más devizában van, és nincs rá árfolyam, az eredmény **„hiányos”** jelzést kap, nem becsüljük.
- **Nem számítanak külső pénzáramnak:** a bevétel (osztalék, kamat), a devizaváltás és a saját számlák közötti átvezetés.
- **Külső pénzáram:** a befizetés, a kivét és a „hiányzó be-/kifizetés” korrekció.
- **Egyeztetési eltérés:** külön listában jelenik meg, nem eladás és nem pénzáram.

## Értékelés és időszakok

- **`valueAt()`:** a nap végi érték. Ami nem értékelhető (hiányzó ár vagy devizaárfolyam), az kimarad az összegből, és „hiányzó” jelzést kap, nincs csendes nullázás. Az elavult ár vagy kézi érték arányát külön kiszámolja.
- **`periodFigures()`:** értékváltozás, nettó külső pénzáram, befektetési eredmény és Modified Dietz a terv 4. pontjának napvégi konvenciójával (`performance.ts`).
  - A később bevont számla nyitó értéke „követésbe vétel” pénzáram.
  - A követés kezdete előtti időszak levágódik („a követés kezdete óta”).

## Rögzítés a felületről (2b)

- **Az űrlaptól az adatbázisig:** a szerverművelet (`recordTransaction`) először `requireTrustedSession()`-t hív, majd a nyers bemenetet Zod ellenőrzi. Utána a `buildTransaction()` (`src/lib/tx/build.ts`) építi fel a tételeket, és a `validateEvent()` ellenőrzi őket. Végül a `public.record_event_bundle()` rögzít, egyetlen tranzakcióban.
- **A `record_event_bundle` az eseménnyel együtt írja:**
  - devizaváltásnál a tényleges árfolyamot `broker` forrású `fx_rates` sorként, az eseményhez kötve. Az árfolyamot az esemény saját két tételéből számolja, így nem térhet el tőlük;
  - nyitó egyenlegnél a nyitónapi kézi árat vagy kézi értéket.
  - Ha bármelyik sor hibás, az esemény sem jön létre.
- **Vétel díja:** a bekerülési érték része. Ha a díj más devizában van, a vétel napjára a `select_fx` szabálya szerint választott árfolyamon számolódik át. Ha nincs ilyen árfolyam, a rögzítés hibát ad, becslés nincs.
- **`cost_fx_refs`:** vételkor, osztalék-újrabefektetéskor, nyitó egyenlegnél és pozitív darabszám-korrekciónál a tétel eltárolja a HUF, EUR és USD kijelzéshez választott árfolyamsorokat, az adott napra.
  - közvetlen vagy fordított árfolyamnál egy azonosítót, keresztárfolyamnál kettőt;
  - `[]`, ha nincs szükség átváltásra; `null`, ha hiányzik az árfolyam;
  - a díj átváltásának sora a `fee` kulcs alá kerül.
- **Split:** a darabszám-változás = a nap végi állomány × (arány − 1), 10 tizedesre kerekítve. Az adatbázis ugyanezt ellenőrzi.
- **Nyitó egyenleg:** a dátum mindig a számla követési kezdőnapja. Ha az eredeti bekerülési érték nem ismert, a nyitó piaci érték lesz, „becsült” jelöléssel.
- **Korrekció:** kötelező megjegyzéssel. Pozitív darabszám-korrekciónál a bekerülési érték a nap piaci értéke (vagy a megadott egységár), „becsült” jelöléssel.
- **Törlés:** egy tranzakció törölhető. A tételei és a bróker-árfolyama vele együtt törlődnek. Ha egy későbbi esemény épül rá (például egy eladás), az előzmény-ellenőrzés megakadályozza a törlést.
- **Ár, árfolyam, kézi érték:** csak bővíthető napló. A javítás új kézi sor, amely a javított sorra hivatkozik, és annak napját örökli. A bróker-árfolyam nem javítható külön, csak a devizaváltás rögzítésével együtt.
- **Devizát váltó BÉT-papír (#41):** a BÉT minden záróárat a saját devizájával ad. Ami az eszköz devizájában van, rendes ár; ami másban, az gyanús (`suspect`) sorként a naplóba kerül, de nem számít. A váltás így nem hiba, és a frissítés nem kéri újra ugyanazokat a napokat.
- **Ár forrás szerint (2026-09-28):** egy eszköz ára csak a saját árforrásából és kézi sorból jöhet (kézi forrású eszköznél bármelyikből). A kézi javítás csak akkor számít, ha a javított sor is számít (javítás javításánál a lánc végén álló eredeti sor dönt). Forrásváltás után (például Yahoo → BÉT) tehát a régi forrás sorai nem számítanak, a kézi árak igen: egy kézi ár a saját időpontjában érvényes, amíg a saját forrásból újabb ár nem jön.

## Pontosság

- **Tizedesek szövegként:** a `numeric` oszlopokat a betöltő szövegként kéri le (`amount::text`), így a JSON-számok 15 jegy feletti kerekítése nem érinti őket. Íráskor is pontos tizedes szöveg megy az adatbázisba.
- **Magyar számbevitel:** az űrlapok az „1 234,56” és az „1234.56” alakot is elfogadják (`parseDecimal`).

## Egyszerű felvitel (4c)

A „Tételek” oldalon egy tétel az, amit az egyszerű űrlap egy egységként rögzít. A háttérben a fenti események jönnek létre, közös `entry_id`-val; a könyvelési mag ezt nem nézi.

- **Az űrlaptól az adatbázisig:** a teljes űrlapállapot egy JSON-mezőben megy a szerverre (`recordEntry` / `replaceEntry`). A Yahoo- és BÉT-adatokat (név, deviza, a vétel napi záróára) a szerver újra lekéri, a böngésző értékei csak előnézetek. A `buildEntry()` (`src/lib/entry/build.ts`, tiszta, tesztelt) építi fel a tételeket, a `validateEvent()` ellenőrzi őket, a `public.record_entry()` pedig egy tranzakcióban rögzíti az új brókert, számlát, eszközöket és a tételeket. A halasztott ellenőrzés egyszer, a végén fut.
- **Nincs „Mai állomány” (a tulajdonos döntése, 2026-09-27):** minden befektetés vételként kerül be a saját vásárlási napjával, a régebben vett, ma is meglévő is. Így a hozam pozíciónként a vétel napjától számolódik. A számlán lévő, be nem fektetett készpénz a Haladó műveleteknél (befizetés, kivét) rögzíthető. A korábban így rögzített nyitó tételek megmaradnak és törölhetők, de az űrlap nem szerkeszti őket.
- **Készpénz a számlán (2026-09-28, spec 3.4):** a vétel először a számla készpénzét használja a vétel devizájában. Elérhető: a vétel napjától máig a legkisebb nap végi egyenleg (`src/lib/entry/cash.ts`), szerkesztéskor a tétel saját eseményei nélkül. Csak a hiányzó rész kerül be befizetésként (ez a vétel napján pénzáram); „Teljes egészében új befizetésből” esetén az egész. Az eladás pénze alapértelmezésként a számlán marad; „Kivettem” esetén ugyanarra a napra kivét is bekerül. Az összeget mindig a szerver számolja, az űrlap csak a választást küldi. Egy tétel szerkesztése vagy egy tétel, illetve haladó művelet törlése nem veheti el azt a pénzt, amelyből egy későbbi vétel fizetett: ha emiatt egy nap végi egyenleg nulla alá menne, a művelet hibát ad (`cashBreaks`). A korábbi tételek (befizetés + vétel, eladás + kivét) változatlanul érvényesek.
- **Egy papír, egy eszköz (#44):** a BÉT-kód és a Yahoo-s `.BD` ikre (például `OTP` és `OTP.BD`) ugyanaz a papír. Ha az egyik már fel van véve, a másikkal rögzített vétel is azt az eszközt kapja, és a becsült ár a meglévő eszköz saját forrásából jön. Ha mindkettő fel van véve, a pontos egyezés számít. Eltérő Yahoo-kódot a Horizon nem köt össze.
- **Vétel ár nélkül:** ha sem egységár, sem teljes összeg nincs megadva, az egységár a papír saját forrásának (Yahoo vagy BÉT) vétel napi (vagy előtte utolsó) záróára, és a bekerülési érték becsült jelölést kap. A záróár önálló árnaplósor, a forrásával (`yahoo` vagy `bet`). Ha arra a napra nincs záróár (vagy más devizában jegyzik), az űrlap kéri az árat. Szerkesztéskor az ármező üresen nyílik, így mentéskor újra a záróárat veszi. Eladásnál az ár vagy az összeg kötelező.
- **Kézi értékű eszköz vétele és kivétje:** a darabszám a legutóbbi érték szerinti egységáron változik (egységár = érték ÷ darab; ha nincs, 1). A kivét így éppen a legutóbbi értékhez mért arányos rész. A tétel eltárolja az új összértéket: a megadottat, vagy ha üres, az előző értéket ± az összeget (a megjegyzés jelzi, melyik).
- **Kezdőnap (T):** az űrlapon nem kell megadni. Új számlánál a vétel előtti nap; ha egy vétel korábbi, T a vétel előtti napra kerül. T soha nem kerül későbbre, és nyitó állomány mellett (Haladó műveletek, régi tételek) nem mozdul: ilyenkor vétel csak T után lehet (`private.check_tracking_start`).
- **Szerkesztés:** `public.replace_entry()` – a régi események helyére egy tranzakcióban az újak kerülnek, ugyanazzal az azonosítóval és a nap sorrendjében ugyanazon a helyen (`created_at`). Az előzmény-ellenőrzés a végeredményt nézi.
- **A tételhez tartozó ár és érték:** a kézi eszköz tételének összértéke (és a régi nyitó tételek ára, értéke) `entry_id`-t kap, és a tétellel együtt törlődik (a rá épülő javítósorokkal együtt). A frissítés sorai, az „Érték frissítése” és a Yahoo- és BÉT-záróárak önálló megfigyelések: továbbra is csak bővíthetők.
- **Törlés:** a `delete_entry`, `delete_account` és `delete_instrument` `security definer` függvény, mert az ár- és értéknapló mindenki más számára csak bővíthető. Mindegyik a megbízható tulajdonost ellenőrzi, és csak a saját sorokat érinti; a naplóból törölt sorokat az auditnapló megőrzi.
- **Gazdátlan eszköz (2026-09-29):** ha egy tétel, haladó művelet vagy számla törlésével egy eszköznek az utolsó sora is megszűnik, az eszköz is törlődik az áraival, értékeivel és ÁKK-adataival együtt (`drop_orphan_instrument` trigger). A trigger a tranzakció végén fut, így szerkesztéskor (`replace_entry`: törlés, majd az új változat) megmarad az az eszköz, amelyet az új változat is használ. Amelyik eszköznek soha nem volt sora (az Eszközök oldalon vették fel), azt nem érinti. Ha később újra felkerül, a Frissítés a piaci árakat újra letölti, a kézi árakat nem.
  - A számla csak a nevének begépelésével törölhető, mindenestül (a másik számlát érintő átvezetés az ottani oldalával együtt). Ha ez volt a bróker utolsó számlája, a bróker is törlődik.
  - Eszköz csak akkor törölhető, ha semmi nem hivatkozik rá; az árai és kézi értékei vele mennek. A devizája csak addig módosítható, amíg nincs hozzá tétel, ár vagy érték.
- **Egy Yahoo-szimbólum vagy BÉT-kód, egy eszköz:** egyedi index forrásonként (tulajdonos + nagybetűs szimbólum, illetve kód). A keresés a meglévő eszközt ajánlja fel, a BÉT-kódnál a `<kód>.BD` Yahoo-eszközt is (OTP ↔ OTP.BD).
- **Tőzsdei papír keresése (2026-09-28):** előbb a BÉT-en (kód szerint, névnél szavanként), és ha ott nincs találat vagy a BÉT nem érhető el, a Yahoo-n. A BÉT-papír neve a kódja; az Eszközök oldalon átnevezhető.
- **Kézi elem név szerint:** ha az űrlapon új kézi elemet adsz meg egy már meglévő kézi elem nevével és devizájával (a kis- és nagybetű nem számít), a meglévőt használja, nem hoz létre másodikat.
- **Frissítés mentés után:** egy tétel mentése után az űrlap lefuttatja a Frissítést (csak a hiányzó árfolyamokat és árakat kéri le), így az új tétel rögtön beszámít az összesbe.

## Állampapírok az ÁKK-ból (2026-09-28, spec: `docs/superpowers/specs/2026-09-28-hazai-arforrasok-design.md`)

- **Eszköz:** egy ÁKK-sorozat egy eszköz (egyedi index: tulajdonos + sorozat). Kötvény, HUF, piaci értékelés, forrás `akk`, forrásazonosító a sorozat neve. Mellette a `bond_terms` tárolja a típust, a lapot, a kibocsátás és a lejárat napját, valamint az önellenőrzés állapotát.
- **Darab = névérték:** 1 darab 1 Ft névérték. Az ár 1 Ft névértékre (vételi árfolyam + felhalmozott kamat) / 100; a kettőt pontosan egyszer adjuk össze. Az érték tehát az, amit ma kapnál érte.
- **Felvitel:** a Vétel fülön névérték és fizetett összeg (a bizonylat szerint), egységár nincs. Üresen csak mai vételnél hagyható, ha a Kincstár ad eladási árfolyamot: ilyenkor névérték × (eladási árfolyam + felhalmozott kamat) / 100, „becsült” jelöléssel. Lejárat után nem vehető és nem adható el.
- **Frissítés:** laponként (`MAP`, `MAPP`) egy lekérés, 15 percen belül nem újra; a BMÁP/PMÁP kamattörténete naponta egyszer. Sorozatonként árnaplósor (`akk`, a nap végére), napi megfigyelés (`bond_observations`), és önellenőrzés: a saját szabályunkkal számolt felhalmozott kamat 4 tizedesig egyezik-e az ÁKK-éval. A lejárat napjától 1,0000-s ár a lejárat napjára.
- **Kamatszabályok (`src/lib/bonds/rules.ts`, a 2026-09-28-i próbán mind a 213 sorozaton igazolva):** MÁP Plusz, FixMÁP, PMÁP Tényleges/Tényleges technikai időszakokkal, BMÁP Tényleges/360. Az időszaki kamat 0,01%-ra, azaz 1 Ft-ra 4 tizedesig kerekítve, szorozva a jogosult névértékkel, egész forintra (általános kerekítés, felfelé a felénél). BMÁP/PMÁP időszakai a kamattörténetből jönnek; FixMÁP és MÁP Plusz időszakai a lejárattól visszafelé, a fél időszaknál rövidebb első csonka a következőhöz csatolódik.
- **Kamatláb:** csak a saját időszakából. BMÁP/PMÁP: a kamattörténet; FixMÁP: bármely rendben lévő megfigyelés (a kamat fix); MÁP Plusz: az időszakba eső (elszámolási nap szerint) rendben lévő megfigyelés. A mai kamatlábbal múltbeli kamat soha nem számolódik.
- **Javaslatok (`pending_events`, „Ellenőrzésre vár”):** a Frissítés hozza létre minden elmúlt kamatnapra és lejáratra, amelyen a tulajdonosnak volt a papírból. Összeg csak ellenőrzött sorozatnál és ismert kamatlábnál, különben „Adat hiányzik” és kézi összeg. Jogosult névérték: ha a kamatnap előtti 14 napban nem változott az állomány, az előző nap végi; különben a második hétköznap végi, „bizonytalan” jelöléssel. Egy papír és számla javaslatai csak időrendben hagyhatók jóvá (a szerver is ellenőrzi). Semmi nem kerül a főkönyvbe jóváhagyás nélkül.
- **Tételek:**
  - **Kamatjóváírás** (`interest_reinvest`, MÁP Plusz): kamatbevétel +X, kereskedés −X, pozíció +X darab X bekerüléssel (ahány forint, annyi névérték).
  - **Kamatfizetés** (`interest`): kamatbevétel a papír számláján. A pénz a számlán marad, „Kivettem” esetén ugyanarra a napra kivét is.
  - **Lejárat** (`maturity`): a teljes névérték −, kereskedési készpénz +, és a kamat bevételként. Realizált eredmény = visszafizetett névérték − a lotok bekerülési értéke. Az adatbázis ellenőrzi, hogy utána nem marad darab a számlán.
- **Visszaküldés ellenőrzésre:** egy jóváhagyott tétel törlése a javaslatot nyitottként visszahozza, ott módosítható és újra jóváhagyható. A törlésre a többi tétel szabályai érvényesek (darabszám-előzmény, `cashBreaks`).

## Még nyitott pontok

- Az aznapi realizált eredmény kijelzési devizában, valamint az ár- és devizaárfolyam-hatás bontása későbbi bővítés. Az adatok (lotonkénti hivatkozások) már rögzülnek.
