# Дома TV за iPhone и iPad — самостојна верзија

Нативна SwiftUI апликација за iOS/iPadOS 17+, без Mac мост, Node.js или веб-сервис. Се поврзува директно со телевизорот на истата доверлива Wi-Fi мрежа. Ова е развојна верзија; не е објавена во App Store и не е инсталирана на физички iPhone/iPad.

## Отворање и инсталација

1. Отвори `DomaTV.xcodeproj` во Xcode на Mac. Ако Xcode побара лиценца или почетно поставување, корисникот треба да ги прегледа и заврши.
2. Во target **DomaTV → Signing & Capabilities**, избери ја својата Development Team. Нема вграден приватен сертификат, Apple профил или provisioning profile.
3. Избери поврзан iPhone/iPad или Simulator и стартувај Run. За физички уред може да се бара Developer Mode и одобрување на уредот. Рокот и можностите на потписот зависат од Apple профилот.
4. Дозволи Local Network кога системот ќе побара.
5. Во Телевизори → Додај TV внеси име, марка и приватна IPv4-адреса. Првото спарување се одобрува на телевизорот. Самопотпишан сертификат бара посебно одобрување на прикажаниот отпечаток.

## Што има

- Долна навигација и контроли за допир на iPhone; странична навигација и приспособлив распоред на iPad.
- Зачувани телевизори, име на соба, омилени, IP и MAC; локално на секој уред.
- LG webOS и Samsung Tizen WebSocket спарување; Philips JointSpace HTTP 1/5.
- Навигација, гласност, mute, канали, број на канал, репродукција и гасење.
- LG: HDMI 1–4 и отворање YouTube/Netflix, ако телевизорот ги има.
- Светла/темна тема, хаптички одговор и пристапни ознаки на копчињата.
- LG/Samsung токени и отпечатоци од TV сертификати во Keychain. Не се зачувуваат во UserDefaults.
- Приватни IPv4 дестинации; HTTP пренасочувања се одбиваат.

## SSDP и Wake-on-LAN: потребна е Apple дозвола

На **физички iOS/iPadOS уред**, multicast и broadcast мрежни операции бараат `com.apple.developer.networking.multicast` entitlement, одобрен од Apple и вклучен во provisioning profile. Тоа се однесува и на SSDP и на broadcast Wake-on-LAN. Само Local Network permission не е доволна.

Затоа стандардниот проект работи со **рачно додавање преку IP** и не го активира entitlement-от автоматски. Копчињата за скенирање/будење ќе објаснат што недостига. По Apple одобрување:

1. Во Signing & Capabilities/Build Settings постави `CODE_SIGN_ENTITLEMENTS = DomaTV/Multicast.entitlements`.
2. Додај `DomaMulticastEnabled = YES` во Info.plist.
3. Користи provisioning profile што го содржи одобрениот entitlement.

Овој Info.plist flag не е замена за потпишаниот entitlement. Simulator може да дозволи multicast без истиот профил, но не е доказ дека функцијата ќе работи на телефон.

## Тајмер и позадина

Sleep timer работи само додека апликацијата е активна. Се откажува при премин во позадина и при промена/прекинување на телевизорот. iOS не гарантира точна долготрајна мрежна команда во позадина; не се користат лажни audio/location background modes. За заклучен телефон користи го сопствениот sleep timer на телевизорот.

## Безбедност и граници

TLS прво се обидува на LG 3001/Samsung 8002. Самопотпишаниот сертификат бара изречно одобрување од корисникот и се пинува по SHA-256 отпечаток. Променет сертификат бара ново одобрување. Ако корисникот одбие, не се продолжува со нешифриран fallback. Некои модели поддржуваат само локален WS/HTTP; користи доверлива домашна мрежа.

Ова не е целосна безбедносна ревизија. Не се поддржани NetCast, стари Samsung протоколи, Philips HTTPS/Digest pairing, Android TV Remote или Apple TV. Реалната достапност на командите зависи од телевизорот. MAC-адреса за LG/Philips обично се внесува рачно, бидејќи iOS не нуди општ ARP пристап. Нема автоматска синхронизација со Mac.

## Верификација

Изворите се компајлирани директно со Apple iOS Simulator SDK. Моделските проверки покриваат приватни/canonical IPv4 адреси, MAC валидација и Codable зачувување. Xcode project/plist синтаксата е проверена. Целосниот `xcodebuild` во оваа средина е блокиран од неприфатена Xcode лиценца. Не се извршени тестови на физички телефон, сертификатен дијалог, вистинско спарување или сите TV команди. Тоа останува услов пред продукциска дистрибуција.

## Apple извори

- [Multicast entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.networking.multicast)
- [Local network privacy](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy)
- [Подготовка за позадина](https://developer.apple.com/documentation/uikit/preparing-your-ui-to-run-in-the-background)
