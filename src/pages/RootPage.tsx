import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';

export function RootPage() {
  return (
    <div className="page-center">
      <VStack gap={2} hAlign="center" maxWidth={420}>
        <Heading level={1}>Онлайн-запись в автостудию</Heading>
        <Text color="secondary" justify="center">Откройте ссылку, которую вам прислала студия: она выглядит как …/s/название-студии/</Text>
      </VStack>
    </div>
  );
}
