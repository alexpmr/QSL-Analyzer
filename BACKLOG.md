# Backlog

Itens solicitados e situação na versão 0.1.0.

| Item | Situação |
|---|---|
| Aplicação "QSL Analyzer" no padrão visual dos projetos PT2VHF | Feito: Electron, cabeçalho com marca/versão, idioma com bandeiras, tema claro/escuro |
| Análise de logs .adif e outros formatos conhecidos | Feito: ADIF, ADX, Cabrillo, EDI, CSV |
| Banco local com novos uploads incrementais (sem duplicar) | Feito |
| Configurações: limpar banco por indicativo | Feito: Configurações → Banco de dados |
| Todos os recursos do QScope (Logs/Containers, Estatísticas, Exportar, Usuário) | Feito: veja o README |
| Menu superior com aba Logs (Containers, Upload, Import, Modify, Copy/Filter, Search) | Feito |
| Aba Estatísticas com as 20 análises | Feito |
| Aba Relatórios com relatório customizável e exportação em PDF | Feito |
| Importação de plataformas como o QRZ.com | Feito: QRZ.com, LoTW, eQSL, Club Log |
| Gráficos de BI "vivos" com interação do usuário | Feito: filtro por clique, período por arraste, legenda interativa, chips, desfazer, animações |
| Publicar no site com versões para Windows, Linux e macOS | Feito: www.pt2vhf.com/qsl, updates.json e update.php |

## Pendentes

- **Roadmap (29/10/2026): indicativo clicável em toda a aplicação.** Sempre que um indicativo aparecer
  (por exemplo, a lista de Estações trabalhadas, Busca no log, duplicados, pontos, DXCC first worked,
  QSOs mais distantes, dashboard), ele deve ser clicável e abrir tudo sobre aquela estação nos meus
  contatos: todos os QSOs (data/hora, banda, modo, RST, frequência, container, estação/operador),
  bandas e modos trabalhados, slots, primeiro e último contato, país/DXCC, zonas, quadrícula, distância
  e azimute, e status de QSL (papel, LoTW, eQSL) de cada QSO.
- **Backlog (29/10/2026): omitir containers e organizar só por estação.** Os containers não devem
  aparecer para o usuário: todos os ADIFs enviados, de qualquer estação, ficam num único container
  interno, e a organização visível é apenas por estação (indicativo/STATION_CALLSIGN). Ajustar: menu Logs
  (sem "Gerenciar containers" e sem escolha de container na importação, em Copiar/filtrar, Modificar e
  plataformas), barra de filtros (sem o filtro Container), dashboard, banco de dados (limpeza só por
  indicativo, sem "Restringir ao container"), Comparar (só estações), busca e textos de ajuda/README.
  A importação incremental continua sem duplicar QSOs (mesma estação, indicativo, banda, modo e minuto).
  Bancos já existentes com mais de um container devem ser unidos no container único, sem duplicar QSOs.
- **Backlog (29/10/2026): aba "Importar/Exportar" no menu superior.** Unir a importação à aba Exportar
  numa única aba do menu superior, onde o usuário tanto importa logs para o app (arquivos ADIF e demais
  formatos, e plataformas online) quanto exporta. Na importação, os contatos que já existirem no banco são
  ignorados. Durante a importação abre um popup com a barra de progresso e as contagens, atualizadas em
  tempo real, de contatos importados e de contatos ignorados por já existirem (e o total processado), com
  o resumo final ao terminar.
- **Backlog (29/10/2026): aviso do site oficial igual ao do Mesh Analyzer.** Trocar o diálogo exibido a
  cada abertura pelo mesmo modelo do PT2VHF Mesh Analyzer: título "Downloads no site oficial"; texto
  "A partir de agora, as novas versões e os instaladores do PT2VHF QSL Analyzer serão distribuídos pelo
  site oficial."; link sublinhado "www.PT2VHF.com" (abre o site); um único botão "Entendi" alinhado à
  direita (com foco). Mesmo visual: cartão escuro com cantos arredondados e borda clara, título em
  negrito, sem os botões "Abrir o site"/"Continuar" atuais. Traduzir para inglês e espanhol. O aviso de
  versão nova continua aparecendo logo depois de fechar este.
- **Backlog (29/10/2026): melhorias de análise dos contatos.** Aprovadas pelo mantenedor; prioridade
  sugerida nesta ordem: progresso de diplomas com "faltam confirmar", resumo em linguagem natural e
  saúde do log.
  1. **Progresso de diplomas:** DXCC (Mixed, Phone, CW, Digital e por banda), WAS, WAZ, WPX, VUCC
     (quadrículas VHF/UHF) e IOTA, com trabalhado, confirmado e o que falta (lista do que falta).
  2. **"Faltam confirmar":** entidades trabalhadas e não confirmadas, com o melhor QSO de cada uma para
     pedir QSL.
  3. **Entidades raras:** destacar as entidades mais procuradas (Most Wanted do Club Log) já trabalhadas.
  4. **"Sua atividade" em linguagem natural no Dashboard:** resumo automático (totais do período, modo
     predominante, melhor mês, contato mais distante, quantas entidades faltam para o DXCC).
  5. **Comparativo de períodos:** este ano × ano passado, este mês × média; o que cresceu, caiu e o que é
     novo.
  6. **Melhor horário por banda e região:** hora UTC × continente para cada banda, a partir dos próprios
     QSOs.
  7. **Alcance por banda ao longo do tempo:** distância e direção dos contatos por banda, mês a mês
     (efeito do ciclo solar).
  8. **Ficha do indicativo ampliada** (complementa o item do indicativo clicável): histórico com a
     estação, datas e quantidade de contatos.
  9. **Amigos frequentes e "sumidos":** estações mais contatadas e as que não aparecem há muito tempo.
  10. **Novos indicativos por período:** indicativos inéditos por mês.
  11. **Saúde do log:** QSOs sem quadrícula, banda incompatível com a frequência, modo inválido,
      possíveis duplicados com poucos minutos de diferença e indicativos possivelmente mal digitados
      (ex.: PT2VHF × PT2VFH), com correção em lote.
  12. **Conferência entre plataformas:** cruzar o log local com LoTW, QRZ e eQSL e listar o que está só
      de um lado, para reenviar.
  13. **Análise de concurso:** detectar o período pelo CONTEST_ID, pontuação estimada, multiplicadores,
      taxa por hora e comparação com o mesmo concurso do ano anterior.
  14. **Sincronização automática:** buscar novidades do QRZ/LoTW ao abrir o app, em segundo plano.
  15. **Painéis salvos:** guardar combinações de filtros com nome (ex.: "2 m FM em 2024").
  16. **Relatório anual pronto:** modelo de PDF "Meu ano no rádio" para compartilhar.
- **Ajuste de CI antes da próxima versão:** o job de release usa `gh release upload --clobber`; um push
  na `main` sem mudar a versão sobrescreveria os pacotes da release já publicada no site (SHA-256 diferente).
  Pular o upload quando a release da versão já existir.

## Próximos passos sugeridos

- HRDLog e Cloudlog/Wavelog via API (hoje: exportar ADIF e enviar).
- Atualização automática do CTY.DAT pela internet.
- Manual em PDF ilustrado, como nos outros aplicativos PT2VHF.
- Assinatura de código (Windows) e notarização Apple (macOS).
