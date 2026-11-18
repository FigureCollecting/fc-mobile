# Privacy

Version of 18 November 2026.

## Who runs this

FigureCollecting is run by one collector, Ross. If you write to us about your data, you are writing to him.

## The short version

- No ads, no trackers and no analytics from other companies.
- We do not sell your data.
- No other account can read your collection, and there is no sharing or public profile today. The person who runs the servers technically can read it.
- Accounts are by invitation.
- You can ask for a copy of your data, or for your account to be deleted, by email. Both are done by hand today.

## Your account

Sign-in runs on our own sign-in server, auth.mindsignals1.com. It holds what you give it when you make the account: a sign-in name, your name, your email address, your password and your second sign-in step (an authenticator app or a security key).

The app never sees your password. You type it on the sign-in server's page, not in the app.

The app's own database knows your account only by a random id. It also lists the devices you have signed in on: a public key for each one and the date it was added.

The sign-in server records each sign-in and each failed sign-in: the time, your sign-in name and email address, your IP address, a rough location (city and country) and network provider worked out from the IP address, and your browser and device. It keeps them for as long as its software does by default. We have not set a shorter limit yet.

## What stays on your device

The app works offline, so it keeps these in your browser's storage:

- a copy of your collection,
- edits that are waiting to sync,
- your sign-in tokens and a device key that cannot be copied off the device,
- your settings: theme, case layout, the photos you chose to display, and recent searches,
- pictures of your figures, and of others you have looked at.

The theme, case layout and photo choices are never sent to us.

The list of recent searches stays on the device. But when you are signed in, what you type in Search is also sent to our server to search the catalogue, once it is two characters long (or one Japanese, Chinese or Korean character). So is a barcode you look up.

To delete all of it from a device, clear this site's data in your browser's site settings. Removing the app or its icon may leave the data behind. Edits that had not synced yet are lost with it.

## Your collection

When you are signed in, the app syncs your collection to our server so your other devices can show it. That is the figures you own, have ordered or wish for, your lists and tags, and what you record about a figure: score, note, wish rating, your own labels and links, and for one you have parted with, the reason, date, note, who it went to and the price. Each edit carries the time you made it and your time zone.

If you import a MyFigureCollection export, we store its rows too. We also keep the history of your edits, which is how sync works.

No other account can read it. Every read and write is tied to your account's id. There is no sharing and no public profile today.

It is not hidden from the person who runs the servers. Like any service that stores data for you, whoever runs it can technically read it.

## Pictures

The figure pictures in the app are catalogue pictures: product photos from shop listings and makers' official photos. They come from our picture server, images.figurecollecting.com.

The app cannot upload a photo today. The only file it accepts is the collection export you choose to import.

## Server logs

Our servers write a log line for each request. The web server that serves the app logs the time, the address asked for, the result and its size, the page that linked to it (the referrer), your browser's name and version (the user agent) and your IP address. The server behind the app logs the time, what was asked for, the result and the network address it came from. The sign-in server's lines also carry your sign-in name. These lines stay on the server that wrote them and are overwritten as the log fills up.

We are adding one central copy of these logs so we can trace a problem. It will be kept for 14 days. In that copy IP addresses are cut short, email addresses are masked, and requests are marked with a request id, not with account details.

## Where it is kept

The servers are in Virginia, USA, rented from OVH. Backups and picture files are in Helsinki, Finland, at Hetzner.

Backups of the sign-in database made since the move to a new backup store on 5 November 2026 reach back three months, and a backup older than that is removed 30 days later. Copies made before that move are kept until we delete them by hand. Backups of the collection database also reach back three months, but the storage keeps the older copies until we delete them by hand. We are setting a limit.

Traffic reaches our servers through Cloudflare. Cloudflare can see your IP address and the traffic it carries for us.

The email that confirms your address is sent through Amazon's mail service, which handles your email address to deliver it.

## What we never do

- We do not show ads.
- We do not use trackers or analytics from other companies. The app loads code only from its own address, and it can talk only to our own address, our sign-in server and our picture server.
- We do not sell your data.

## Getting an account

Accounts are by invitation. Ross sends you a link that works once and expires within two weeks. It opens our sign-in server, where you give a sign-in name, your name, your email address and a password, and set up the second sign-in step. The account starts working when you follow the link in the email that confirms your address.

## A copy of your data, or deleting it

The app cannot do either by itself yet.

Write to privacy@figurecollecting.com from the email address on your account. Ross will send you a copy of your collection, or close your account and delete its data by hand. Copies stay inside the backups until those backups are removed, as described under Where it is kept.

## Contact

Questions, objections or anything that looks wrong: privacy@figurecollecting.com.

If this page changes, the date at the top changes with it.
