# Create Release Keystore — Run Once Before Play Store Upload

## Step 1: Generate keystore

Run this in a terminal (works on Windows with Java/Android Studio installed):

```
keytool -genkey -v -keystore jago-release-key.jks -keyalg RSA -keysize 2048 -validity 10000 -alias jago
```

You will be prompted for:
- Store password (remember this!)
- Key password (can be same as store password)
- Name, organization, city, country

Save the generated `jago-release-key.jks` file somewhere safe (NOT inside git repo).

## Step 2: Create key.properties for Customer App

Create file: `flutter_apps/customer_app/android/key.properties`

```
storePassword=YOUR_STORE_PASSWORD
keyPassword=YOUR_KEY_PASSWORD
keyAlias=jago
storeFile=../../../jago-release-key.jks
```

## Step 3: Create key.properties for Driver App

Create file: `flutter_apps/driver_app/android/key.properties`

```
storePassword=YOUR_STORE_PASSWORD
keyPassword=YOUR_KEY_PASSWORD
keyAlias=jago
storeFile=../../../jago-release-key.jks
```

## Step 4: Add key.properties to .gitignore

```
echo "key.properties" >> flutter_apps/customer_app/android/.gitignore
echo "key.properties" >> flutter_apps/driver_app/android/.gitignore
echo "*.jks" >> .gitignore
```

## Step 5: Build signed release APKs

```
cd flutter_apps/customer_app
flutter build apk --release

cd ../driver_app
flutter build apk --release
```

## IMPORTANT
- Keep jago-release-key.jks backed up safely
- Never commit key.properties or .jks to git
- If you lose the keystore, you CANNOT update the app on Play Store
