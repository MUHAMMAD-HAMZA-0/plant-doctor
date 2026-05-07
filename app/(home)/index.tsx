import { SignedIn, SignedOut } from '@clerk/clerk-expo'
import { Redirect } from 'expo-router'
import ImagePickerScreen from '@/app/components/ImagePickerScreen'

export default function Page() {
  return (
    <>
      <SignedIn>
        <ImagePickerScreen />
      </SignedIn>
      <SignedOut>
        <Redirect href="/(auth)/sign-in" />
      </SignedOut>
    </>
  )
}
