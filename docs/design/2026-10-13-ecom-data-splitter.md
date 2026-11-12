# Découpage des ecom-data

**Date :** 2026-10-13
**Statut :** contrat. Le découpage et le MCP ne sont pas encore implémentés.
**Périmètre :** l’archive site SFCC. Le dépôt ne versionne aujourd’hui qu’une partie (`ecom-data-meta`, une partie de `ecom-data-sites`). Les règles couvrent aussi le reste, tel qu’il sort d’un export complet.

Références utilisées pour figer l’ordre des balises et le grain :

- XSD versionnés : `sfcc-data-cli/dwapp-schema/` (`metadata.xsd`, `library.xsd`, `slot.xsd`, `sort.xsd`, `search2.xsd`, `catalog.xsd`, …)
- Export de contrôle : `/Users/Shared/code/bolle/SFCC-toolbox/#INPUTS/STG-full-for-SB`

Les archives SFCC restent des XML uniques à l’import. Dans git, chaque objet métier est un petit fichier. On retrouve une information par le nom du dossier et du fichier. Un ajout ou une suppression est un diff d’un fichier. La recomposition recolle ces fichiers dans le XML que Business Manager importe.

## Où chercher

Les chemins ci-dessous sont relatifs à `ecom-data/`. Le numéro `042` est le rang de `Profile` dans `ecom-data/ranks/v1.yaml`. Une autre version de ce fichier peut attribuer un autre numéro. Le script et le MCP lisent la version désignée par `data-splitter.yaml`, ils n’ont pas de table en dur.

| Je cherche | Fichier |
|---|---|
| Attribut système de Profile | `ecom-data-meta/meta/system-objecttype-extensions/042-Profile/system-attribute-definitions/042-SA-UUID.xml` |
| Attribut custom de Profile | `ecom-data-meta/meta/system-objecttype-extensions/042-Profile/custom-attribute-definitions/042-CA-yotpoLoyaltyTier.xml` |
| Groupe Business Manager de Profile | `ecom-data-meta/meta/system-objecttype-extensions/042-Profile/group-definitions/042-G-01-Standard.xml` |
| Attribut d’un custom type | `ecom-data-meta/meta/custom-objecttype-definitions/007-RXVoucher/attribute-definitions/007-CA-FrameOfferSegment.xml` |
| Préférence d’un site | `ecom-data-sites/sites/Bolle_EU/preferences/custom-preferences/staging/isRXD2CEnabled.xml` |
| Job | `ecom-data-sites/jobs/Bollé-Safety-NetSuite-RET02-Export-Returns-US.xml` |
| Service, credential, profil | `ecom-data-sites/services/service/…`, `…/service-credential/…`, `…/service-profile/…` |
| Contenu de library | `ecom-data-sites/libraries/BolleEUSharedLibrary/library/content/minicart-default.xml` |
| Slot | `ecom-data-sites/sites/Bolle_EU/slots/configurations/minicart-banner__global__minicart-default.xml` |

Le nom du fichier reprend l’identifiant métier. Le même identifiant est dans la balise XML (`attribute-id`, `job-id`, `content-id`, …). Les deux doivent être égaux.

## Principe

```
fragments (git)  →  filtre disabled/allow  →  wrappers  →  ecom-data/.composed/  →  zip d’import
```

- La source de vérité est l’arborescence découpée.
- `ecom-data/.composed/` est un produit de build, ignoré par git. C’est lui que l’on zippe (`ecom-data-meta.zip`, `ecom-data-sites.zip`), avec la même racine qu’aujourd’hui.
- Un fragment est le XML intérieur, sans déclaration `<?xml`, sans `xmlns`. Le wrapper porte la déclaration, le namespace, et l’ordre des balises imposé par le XSD.
- Les fragments d’une même section sont concaténés dans l’ordre lexicographique des noms de fichiers. L’indentation du fichier est à la colonne 0. La recomposition indente chaque ligne avec les espaces qui précèdent le placeholder.
- Une section dont le XSD dit `minOccurs="0"`, et qui n’a aucun fragment retenu, est omise avec sa balise. C’est le cas d’`Appeasement` (pas de `custom-attribute-definitions`) et d’une portée de préférences vide (`preferences.xsd` : chaque portée est `minOccurs="0"`).
- Une section `minOccurs="1"` vide fait échouer la recomposition. Exemple : le `header` d’un pricebook, le `key-definition` d’un custom type.
- Si un dossier découpé et l’ancien fichier monolithique coexistent, la recomposition échoue. Après la première découpe validée, le monolithique sort du dépôt.
- Un type d’import présent dans `ecom-data` sans règle dans ce document fait échouer la recomposition. On ajoute la règle ici avant d’ajouter le fichier.

`version.txt` est copié tel quel. Il reste le fichier généré Demandware, non édité.

## Noms de fichiers

### Rang stable

Les rangs vivent dans un fichier de config, pas dans ce document. La première version est `ecom-data/ranks/v1.yaml`. `data-splitter.yaml` pointe dessus (`ranks: ranks/v1.yaml`). Passer à une nouvelle numérotation, c’est ajouter `ranks/v2.yaml` et changer cette ligne. Le script ne réécrit jamais les valeurs déjà présentes dans le fichier qu’on lui donne.

`v1.yaml` est amorcé avec les `type-id` du meta actuellement dans git, par ordre alphabétique (`Profile` = 42, `RXVoucher` = 7). Les rangs d’ordre (groupes, méthodes de livraison, etc.) sont ajoutés au même fichier par `split-export --update-ranks`, à la position qu’ils ont dans l’export, et ils y restent.

Un identifiant absent du fichier reçoit `max + 1` dans sa séquence, seulement avec `--update-ranks`. Sans ce drapeau, l’identifiant inconnu fait échouer la commande. Un trou (entrée retirée du fichier, ou id supprimé) n’est pas rebouché. Largeur affichée : 3 chiffres sous 1000 (`001`, `042`), portée par le champ `width`.

Le dossier d’un type est `{rang}-{typeId}`. Le `type-id` du wrapper est la partie du nom après le premier tiret.

```yaml
# ecom-data/ranks/v1.yaml
version: 1
width: 3
sequences:
  system-objecttype-extensions:
    Appeasement: 1
    Profile: 42
    TrackingRef: 63
  custom-objecttype-definitions:
    RXVoucher: 7
order: {}
# après la première découpe, par exemple :
# system-objecttype-extensions/Profile/group-definitions/Standard: 1
```

`sequences` numérote les objets à rang de dossier. Le fichier commité liste les 63 types système et les 15 custom types. `order` numérote les listes dont l’ordre est visible. La clé est `séquence/parent/section/id`. Cette map part vide : `split-export --update-ranks` la remplit, puis on la commite.

### Deux formes

**Identifié** — l’ordre dans le XML importé n’a pas d’effet visible. Le nom est l’identifiant :

`042-SA-UUID.xml`, `042-CA-yotpoLoyaltyTier.xml`, `minicart-default.xml`

**Ordonné** — l’ordre du XML est l’ordre affiché dans Business Manager ou le storefront (groupes d’attributs, méthodes de livraison, méthodes de paiement, cartes, règles de tri, redirections de recherche). Le nom porte un second rang stable, figé à la création :

`042-G-01-Standard.xml`

Le `01` est la valeur enregistrée dans `ranks/v1.yaml` pour cette clé d’ordre. Un nouveau groupe prend le `max + 1` de sa séquence. Supprimer l’entrée `01` ne renumérote pas `02`.

### Caractères interdits

L’identifiant est repris tel quel quand il ne contient que des lettres Unicode, des chiffres, `_` et `-`. Les accents restent, pour que le nom de fichier se lise comme l’identifiant. Tout autre caractère (`espace`, `/`, `\`, `:`, `*`, `?`, `"`, `<`, `>`, `|`, `%`, `.`) devient `-`. Les `-` consécutifs sont fusionnés, ceux en début et fin sont retirés. `Bollé Safety - NetSuite - RET02 - Export Returns US` devient `Bollé-Safety-NetSuite-RET02-Export-Returns-US.xml`.

Deux identifiants qui produisent le même nom font échouer la découpe. Le message cite les deux identifiants bruts. Aucun suffixe n’est inventé : on renomme à la main, le fichier doit rester trouvable.

Le préfixe de rôle est collé à l’identifiant :

| Préfixe | Rôle |
|---|---|
| `SA` | system attribute |
| `CA` | custom attribute, ou attribut d’un custom type |
| `G` | attribute group |

## Filtre `data-splitter.yaml`

Fichier : `ecom-data/data-splitter.yaml`. Il ne décide pas comment découper. Il retire des fragments de l’archive importée. Les fichiers restent dans git.

```yaml
# ecom-data/data-splitter.yaml
# Chemins relatifs à ecom-data/, sans glob.
# Un chemin désigne un fichier ou tout ce qui est en dessous.

ranks: ranks/v1.yaml

disabled: []

allow: []
```

`ranks` est relatif à `ecom-data/`. Les XSD sont ceux de `sfcc-data-cli/dwapp-schema/`. `schemaDir` dans ce fichier est optionnel : sans lui, la CLI utilise ce dossier. Un chemin donné est relatif au fichier de config.

Overlay par environnement, chargé quand `DATA_SPLITTER_ENV` est posé. Les listes de l’overlay sont ajoutées à celles du fichier de base.

```yaml
# ecom-data/data-splitter.staging.yaml
# Tout le contenu de la library est hors import STG,
# sauf l’asset nécessaire au test du minicart.
disabled:
  - ecom-data-meta/meta/custom-objecttype-definitions/007-RXVoucher/attribute-definitions/007-CA-FrameOfferSegment.xml
  - ecom-data-sites/libraries/BolleEUSharedLibrary/library/content

allow:
  - ecom-data-sites/libraries/BolleEUSharedLibrary/library/content/minicart-default.xml
```

Un chemin **correspond** à un fichier si le chemin du fichier (relatif à `ecom-data/`, séparateur `/`) est égal au motif, ou commence par le motif suivi de `/`.

Pour chaque fichier :

1. S’il ne correspond à aucun `disabled`, il est importé. Une liste `allow` vide laisse passer tout le reste.
2. S’il correspond à un `disabled` et à aucun `allow`, il est exclu.
3. S’il correspond aux deux, le motif le plus long gagne. À longueur égale, `allow` gagne.

Conséquences du exemple STG :

- `…/content/minicart-default.xml` correspond au dossier `content` (disabled) et au fichier lui-même (allow, plus long) → importé.
- `…/content/footer.xml` ne correspond qu’au dossier → exclu.
- `…/folder/root.xml` et `library.wrapper.xml` ne sont pas sous `content` → importés. L’archive contient la library, ses dossiers, et ce seul asset.
- `007-CA-FrameOfferSegment.xml` est exclu. Le reste de `RXVoucher` est importé.
- Désactiver `ecom-data-sites/libraries/BolleEUSharedLibrary` entier retire aussi `static/`. Désactiver seulement `library/content` laisse `static/` en place.

Retirer un fragment de l’archive n’efface pas la donnée déjà présente sur l’instance : l’import metadata, préférences, jobs et services est une fusion. Pour un contenu de library ou une slot configuration, le schéma accepte `mode="delete"` sur l’élément. C’est le fragment lui-même qui porte cet attribut quand on veut une suppression à l’import.

## Wrappers

Un wrapper est un fichier commité à côté des fragments. Il ne contient que la coquille : déclaration, namespace, balises de structure, placeholders. Le placeholder est le seul texte entre accolades. S’il apparaît dans un fragment, la recomposition échoue.

Placeholder de racine, commun aux fichiers qui sont une liste plate :

```xml
<?xml version="1.0" encoding="UTF-8"?>
<metadata xmlns="http://www.demandware.com/xml/impex/metadata/2006-10-31">

{0}
</metadata>
```

`{0}` est remplacé par la concaténation des unités enfants, dans l’ordre des noms de dossiers.

## Règles par type

Chaque règle fixe le fichier SFCC produit, le grain (ce qu’on ajoute ou supprime d’un geste), et le wrapper. Les namespaces sont ceux des exports actuels.

### meta / system-objecttype-extensions

Produit : `ecom-data-meta/meta/system-objecttype-extensions.xml`
Namespace : `http://www.demandware.com/xml/impex/metadata/2006-10-31`
Aujourd’hui : 12 687 lignes, 63 `type-extension`. Les plus gros : `Product` (207 attributs custom, 18 groupes), `SitePreferences` (338 attributs custom, 45 groupes), `Profile` (25 système, 20 custom, 8 groupes).

```
ecom-data-meta/meta/system-objecttype-extensions/
├── system-objecttype-extensions.wrapper.xml
├── 001-Appeasement/
│   ├── 001-Appeasement.wrapper.xml
│   └── system-attribute-definitions/
│       ├── 001-SA-appeasementNumber.xml
│       └── …
├── 042-Profile/
│   ├── 042-Profile.wrapper.xml
│   ├── system-attribute-definitions/
│   │   ├── 042-SA-UUID.xml
│   │   └── 042-SA-taxIDType.xml
│   ├── custom-attribute-definitions/
│   │   ├── 042-CA-yotpoLoyaltyTier.xml
│   │   └── …
│   └── group-definitions/
│       ├── 042-G-01-Standard.xml
│       └── …
└── 063-TrackingRef/
    └── 063-TrackingRef.wrapper.xml
```

On ne crée un dossier de section que s’il contient au moins un fragment. `TrackingRef` n’a aucune section : le wrapper émet `<type-extension type-id="TrackingRef"/>`.

`system-objecttype-extensions.wrapper.xml` est le wrapper racine `{0}` montré plus haut. Chaque unité enfant est le résultat du wrapper de type.

`042-Profile.wrapper.xml` :

```xml
<type-extension type-id="Profile">
    <system-attribute-definitions>
{systemAttributeDefinitions}
    </system-attribute-definitions>
    <custom-attribute-definitions>
{customAttributeDefinitions}
    </custom-attribute-definitions>
    <group-definitions>
{groupDefinition}
    </group-definitions>
</type-extension>
```

L’ordre des trois sections est celui du XSD. Une section dont le placeholder est vide est retirée avec sa balise.

`042-SA-UUID.xml` :

```xml
<attribute-definition attribute-id="UUID">
    <min-length>0</min-length>
    <field-length>28</field-length>
</attribute-definition>
```

`042-SA-taxIDType.xml` :

```xml
<attribute-definition attribute-id="taxIDType">
    <value-definitions>
        <value-definition default="true">
            <display xml:lang="x-default">Arbitrary</display>
            <value>Arbitrary</value>
        </value-definition>
        <value-definition>
            <display xml:lang="x-default">CPF</display>
            <value>CPF</value>
        </value-definition>
    </value-definitions>
</attribute-definition>
```

Les valeurs d’énumération restent dans le fichier de l’attribut. Leur ordre est l’ordre affiché dans Business Manager.

Un groupe reste un seul fichier. L’ordre des `<attribute>` à l’intérieur est l’ordre des champs dans Business Manager. Retirer un attribut, c’est supprimer son fichier de définition et retirer la ligne `<attribute>` des groupes qui le citent.

| Section | Forme du nom | Tri |
|---|---|---|
| `system-attribute-definitions` | `{rang}-SA-{attribute-id}.xml` | identifié |
| `custom-attribute-definitions` | `{rang}-CA-{attribute-id}.xml` | identifié |
| `group-definitions` | `{rang}-G-{ordre}-{group-id}.xml` | ordonné |

Le `type-id` du wrapper doit être égal au suffixe du dossier.

### meta / custom-objecttype-definitions

Produit : `ecom-data-meta/meta/custom-objecttype-definitions.xml`
Même namespace metadata.
Aujourd’hui : 15 `custom-type`.

```
ecom-data-meta/meta/custom-objecttype-definitions/
├── custom-objecttype-definitions.wrapper.xml
└── 007-RXVoucher/
    ├── 007-RXVoucher.wrapper.xml
    ├── header.xml
    ├── attribute-definitions/
    │   ├── 007-CA-BundleID.xml
    │   └── 007-CA-FrameOfferSegment.xml
    └── group-definitions/
        └── 007-G-01-….xml
```

`header.xml` regroupe les éléments qui décrivent le type, dans l’ordre du XSD : `display-name`, `description`, `staging-mode`, `storage-scope`, `retention-days`, `key-definition`. Il y a une seule clé dans les types actuels. Elle n’est pas éclatée.

```xml
<custom-type type-id="RXVoucher">
{header}
    <attribute-definitions>
{attributeDefinitions}
    </attribute-definitions>
    <group-definitions>
{groupDefinition}
    </group-definitions>
</custom-type>
```

Même règle d’omission que pour les type-extension. Supprimer le type = supprimer le dossier `007-RXVoucher`. Supprimer un attribut = supprimer `007-CA-FrameOfferSegment.xml`.

Le chemin de filtre correspondant est le chemin réel du fichier, pas un raccourci sans rang :

`ecom-data-meta/meta/custom-objecttype-definitions/007-RXVoucher/attribute-definitions/007-CA-FrameOfferSegment.xml`

### jobs

Produit : `ecom-data-sites/jobs.xml`
Namespace : `http://www.demandware.com/xml/impex/jobs/2015-07-01`
Grain : un `<job job-id="…">` par fichier. 138 jobs aujourd’hui.
Forme : identifié. Dossier `ecom-data-sites/jobs/`, wrapper `jobs.wrapper.xml` avec racine `<jobs>` et placeholder `{0}`.

Un job n’est pas redécoupé par `<step>`. Le step n’a de sens qu’à l’intérieur de son job, et le fichier de job reste lisible d’un bloc.

### services

Produit : `ecom-data-sites/services.xml`
Namespace : `http://www.demandware.com/xml/impex/services/2014-09-26`
Aujourd’hui : 35 credentials, 18 profils, 77 services.

```
ecom-data-sites/services/
├── services.wrapper.xml
├── service-credential/
│   └── Bolle-Egnyte-SFTP-UAT.xml
├── service-profile/
│   └── CybersourceProfile.xml
└── service/
    └── Bolle-Egnyte-SFTP-UAT.xml
```

L’ordre XSD est credential, puis profile, puis service. Chaque fragment est l’élément complet (`<service-credential>`, `<service-profile>` ou `<service>`). Forme identifiée, clé = `service-credential-id`, `service-profile-id`, `service-id`.

Les mots de passe déjà chiffrés (`encrypted="true"`) restent dans le fragment, inchangés.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<services xmlns="http://www.demandware.com/xml/impex/services/2014-09-26">
{serviceCredentials}
{serviceProfiles}
{services}
</services>
```

### preferences (organisation et site)

Deux emplacements, même règle :

- `ecom-data-sites/preferences.xml` — préférences d’organisation
- `ecom-data-sites/sites/{site}/preferences.xml` — 23 sites, jusqu’à ~11 000 lignes

Namespace : `http://www.demandware.com/xml/impex/preferences/2007-03-31`
Grain : un `<preference preference-id="…">` par fichier. La valeur de development et celle de production sont deux fichiers, pour qu’un changement de sandbox ne touche pas la production.

```
ecom-data-sites/sites/Bolle_EU/preferences/
├── preferences.wrapper.xml
├── standard-preferences/
│   ├── all-instances/
│   ├── development/
│   ├── staging/
│   └── production/
└── custom-preferences/
    ├── all-instances/
    ├── development/
    ├── staging/
    └── production/
        └── isRXD2CEnabled.xml
```

```xml
<preference preference-id="isRXD2CEnabled">true</preference>
```

Le corps peut être du texte long ou du JSON. Il reste entier dans ce fichier. Forme identifiée. Une portée sans fichier n’est pas émise : `preferences.xsd` la déclare `minOccurs="0"`. L’ordre des portées présentes reste `all-instances`, `development`, `staging`, `production`, d’abord sous `standard-preferences`, puis sous `custom-preferences`.

Le même squelette sert au `preferences.xml` d’organisation.

### sites / site.xml et cartridge path

Le reste de `site.xml` (`name`, `currency`, `taxation`, `brand`, statut et mot de passe storefront) reste un seul fichier. Namespace `http://www.demandware.com/xml/impex/site/2007-04-30`.

`<custom-cartridges>` est traité à part. C’est une seule chaîne `cartouche:cartouche:…`, et l’ordre est l’ordre de résolution (la première gagne). Aujourd’hui, ajouter une cartouche réécrit toute la ligne : la PR est illisible, et deux PR qui touchent le même site conflictent sur cette ligne. `lib_productlist` apparaît deux fois dans le path : le nom seul ne suffit pas comme clé.

Un fichier par position, le rang est dans le nom, espacé de 10 :

```
ecom-data-sites/sites/Bolle_EU/cartridge-path/
├── 010-app_custom_service_cloud
├── 020-plugin_service_cloud
├── 030-app_custom_bolle
├── …
├── 160-lib_productlist
├── 170-plugin_giftregistry
└── 180-lib_productlist
```

Le fichier contient une ligne, le nom de la cartouche, identique au suffixe du nom de fichier. La recomposition trie les préfixes numériques et recolle avec `:`.

```xml
<custom-cartridges>{cartridgePath}</custom-cartridges>
```

Ajouter une cartouche entre `010` et `020`, c’est créer `015-ma_cartouche` et rien d’autre. Retirer une cartouche, c’est supprimer son fichier. Aucun voisin n’est renuméroté, donc deux PR qui ajoutent des cartouches différentes n’ont pas de fichier en commun.

Ces rangs ne vont pas dans `ranks/v1.yaml`. Une clé ajoutée au même endroit de ce fichier recreerait le conflit. Le rang est le fichier lui-même. Deux fichiers du même dossier avec le même préfixe font échouer la recomposition : chacun choisit un cran libre. Le même nom de cartouche à deux rangs différents est valide (`lib_productlist`).

Le cartridge path Business Manager est la préférence d’organisation `CustomCartridges` (`ecom-data-sites/preferences.xml`, portée `all-instances`, aujourd’hui `bm_seamless:app_custom_google_shopping:…`). Même règle, autre dossier :

```
ecom-data-sites/cartridge-path/
├── 010-bm_seamless
└── 020-app_custom_google_shopping
```

Il est recomposé dans `<preference preference-id="CustomCartridges">`, pas dans le `site.xml`. Le MCP `create_fragment` pour un path propose le cran libre au milieu de l’intervalle demandé et n’écrit que ce fichier.

### customer-groups

Produit : `sites/{site}/customer-groups.xml`
Namespace : `http://www.demandware.com/xml/impex/customergroup/2007-06-30`
Deux listes, dans l’ordre de `customergroup.xsd` :

- `customer-group/` — un `<customer-group group-id="…">`. Forme identifiée.
- `group-assignment/` — un `<group-assignment group-id="…" customer-no="…">`. Nom `{group-id}__{customer-no}.xml`. Sur STG, Bolle_EU a 55 groupes et 10 assignations.

Les identifiants contiennent des espaces et des `%` (`Agents-65%` → `Agents-65.xml`, `FFS-25%__00046507.xml`). Le `group-id` dans le XML garde la valeur brute.

### payment-methods et payment-processors

`payment-methods.xml` a pour racine `<payment-settings>` (namespace `http://www.demandware.com/xml/impex/paymentsettings/2009-09-15`). Deux listes ordonnées, parce que l’ordre Business Manager suit le fichier :

- `payment-method/` → `<payment-method method-id="…">`, nom `{ordre}-{method-id}.xml`
- `payment-card/` → `<payment-card card-type="…">`, nom `{ordre}-{card-type}.xml`

`payment-processors.xml`, namespace `http://www.demandware.com/xml/impex/paymentprocessor/2007-03-31`. Grain : un `<payment-processor processor-id="…">`. Forme identifiée. Le bloc `<preferences>` du processeur (les quatre portées) reste dans le fichier du processeur.

### shipping

Produit : `sites/{site}/shipping.xml`
Namespace : `http://www.demandware.com/xml/impex/shipping/2007-03-31`
Grain : un `<shipping-method method-id="…">`. Forme ordonnée (`{ordre}-{method-id}.xml`), l’ordre du checkout suit le fichier. L’attribut `default="true"` reste sur l’élément.

### tax

Produit : `sites/{site}/tax.xml`
Namespace : `http://www.demandware.com/xml/impex/tax/2007-02-14`
Trois listes identifiées :

| Dossier | Élément | Clé du nom |
|---|---|---|
| `tax-classes` | `tax-class` | `class-id` |
| `tax-jurisdictions` | `tax-jurisdiction` | `jurisdiction-id` |
| `tax-rates` | `tax-rate` | `{jurisdiction-id}__{class-id}` |

Le wrapper conserve l’ordre XSD classes, jurisdictions, rates.

### search2

Produit : `sites/{site}/search2.xml`
Namespace : `http://www.demandware.com/xml/impex/search2/2010-02-19`

Ordre de `search2.xsd` : `searchable-attributes`, `stopword-list*`, `synonym-list*`, `hypernym-list*`, `redirect-list`, `suggestion-list*`, `compound-word-list*`, `common-phrase-list*`, `category-exclusion-list*`, `stemming-exception-list*`, `index-settings`, `keyword-group-list`.

| Dossier | Grain | Forme |
|---|---|---|
| `searchable-attributes` | un `searchable-attribute` | identifié, nom = `attribute-path` assaini (`product.name` → `product-name`) |
| `stopword-list`, `synonym-list`, `hypernym-list`, `suggestion-list`, `compound-word-list`, `common-phrase-list`, `category-exclusion-list`, `stemming-exception-list` | le bloc entier d’une langue | identifié, nom = `xml:lang`. Les entrées internes restent dans le fichier de langue |
| `redirect-list` | un `redirect` | ordonné. Pas d’id stable : `{ordre}.xml` |
| `index-settings`, `keyword-group-list` | le bloc entier | un seul fichier |

Bolle_EU sur STG a des `synonym-list`, un `suggestion-list` et un `compound-word-list` en plus des stopwords. Le dépôt actuel a surtout stopwords, hypernymes et redirects. Le wrapper émet seulement les sections qui ont des fichiers.

### url-rules

Produit : `sites/{site}/url-rules.xml`
Namespace : `http://www.demandware.com/xml/impex/urlrules/2012-12-01`

Les réglages scalaires restent dans le wrapper. Les éclater en donnerait une vingtaine de fichiers d’une ligne, alors qu’on les lit ensemble. Aujourd’hui chaque site n’a qu’une langue, `x-default`.

Ordre de `urlrules.xsd` (une balise absente de l’export est simplement omise) :

`general-settings`, `locale-settings`, `category-rule`, `category-page-url-override`, `category-trailing-slash`, `category-offline-url-generation`, `category-search-refinement-url-enabled`, `category-search-refinements*`, `product-rule`, `product-page-url-override`, `product-id-separator`, `folder-rule`, `folder-page-url-override`, `folder-trailing-slash`, `folder-offline-url-generation`, `folder-search-refinement-url-enabled`, `folder-search-refinements*`, `content-rule`, `content-page-url-override`, `content-id-separator`, `pipeline-aliases*`, `pipeline-trailing-slash`, `pipeline-perform-redirect`, `character-replacements*`, `search-refinement-url-settings`.

`category-search-refinements` et `folder-search-refinements` sont des listes identifiées, un fichier par refinement, insérées à leur place. `locale-settings` est un seul fichier s’il est présent.

Deux listes, insérées à leur place dans cette séquence :

- `{pipelineAliases}` produit un `<pipeline-aliases xml:lang="…">` par dossier de langue. Grain : `pipeline-aliases/{lang}/{pipeline}.xml`, un `<pipeline-alias pipeline="…">`. Forme identifiée.
- `{characterReplacements}` produit un `<character-replacements xml:lang="…">` par langue. Grain : `character-replacements/{lang}/{character}.xml`, un `<character-replacement>`. Le nom est le caractère assaini. Forme identifiée.

Une langue supplémentaire ajoutée plus tard est un dossier `{lang}` de plus. Le wrapper émet les blocs de langue en ordre lexicographique du code langue.

### pagemetatag

Produit : `ecom-data-sites/pagemetatag.xml`
Namespace : `http://www.demandware.com/xml/impex/pagemetatag/2016-08-22`

- `page-meta-tag-definitions/{meta-tag-id}.xml` — identifié. L’attribut `type` (`name`, `title`, …) reste sur l’élément. Si deux définitions partagent un `meta-tag-id` avec un `type` différent, le nom devient `{meta-tag-id}__{type}.xml`.
- `page-meta-tag-rules/{page-type}/{ordre}-{rule-id}.xml` — ordonné. `page-type` est le nom de la balise parente : `product-detail-page-meta-tag-rules`, `product-listing-page-meta-tag-rules`, `content-detail-page-meta-tag-rules`, `content-listing-page-meta-tag-rules`.

### sort

Produit : `ecom-data-sites/sort.xml` et `sites/{site}/sort.xml`. Même schéma.
Namespace : `http://www.demandware.com/xml/impex/sort/2009-05-15`

Ordre de `sort.xsd` : `dynamic-attribute*`, `sorting-rule*`, `sorting-rule-assignment*`, `sorting-rule-campaign-assignment*`, `sorting-options`, `keyword-search-sorting-rule-assignment*`, `keyword-search-sorting-rule-campaign-assignment*`, `boost-bury-rule*` (1000 max).

Chaque élément répété est un fichier, forme identifiée par son id (`rule-id`, et les ids d’assignation). `sorting-options` est un seul fichier. Le `sort.xml` global du dépôt n’a qu’une règle (`Einstein Automatic Sort for Revenue`). Le `sort.xml` de Bolle_EU sur STG a 8 attributs dynamiques, 13 règles et 11 assignations : même découpage.

### ocapi-settings (JSON)

Deux niveaux :

- `ecom-data-sites/ocapi-settings/wapi_data_config.json` et `wapi_shop_config.json`
- `ecom-data-sites/sites/{site}/ocapi-settings/wapi_shop_config.json`

Grain : un client OCAPI par fichier, clé `client_id`. Le `_v` reste dans le wrapper JSON. La recomposition JSON parse les fragments et les place dans le tableau `clients`. Elle ne concatène pas du texte, pour éviter les virgules finales.

```
ecom-data-sites/ocapi-settings/wapi_data_config/
├── wapi_data_config.wrapper.json
└── clients/
    └── 4b2034bf-3cf5-4fdc-a15d-70bc15f3da47.json
```

Les ressources à l’intérieur d’un client restent dans le fichier du client.

### webdav

Produit : `ecom-data-sites/webdav/client_permissions.json`
Grain : un objet du tableau `clients`, nom = `client_id`. Même principe que l’OCAPI : parse, puis insertion dans le tableau. Petit fichier aujourd’hui, la règle existe pour que l’ajout d’un client soit un fichier nouveau.

### libraries

Absentes du dépôt git. Présentes dans l’export STG, à deux endroits :

- library partagée : `libraries/BolleEUSharedLibrary/library.xml` (30 Mo, 4 `folder`, 3 478 `content`)
- library privée de site : `sites/{site}/library/library.xml` (Bolle_EU n’a que le folder `root`)

Même règle pour les deux. L’arbre ci-dessous est celui de la library partagée. Pour un site, la racine source est `ecom-data-sites/sites/{site}/library/` et le fichier produit reste `sites/{site}/library/library.xml`.

Source :

```
ecom-data-sites/libraries/BolleEUSharedLibrary/
├── library/
│   ├── library.wrapper.xml
│   ├── header.xml                  # optionnel, élément <header>
│   ├── folder/
│   │   └── root.xml                # <folder folder-id="root">
│   └── content/
│       └── minicart-default.xml    # <content content-id="minicart-default">
└── static/                         # copié tel quel, pas un fragment XML
```

Produit : `libraries/BolleEUSharedLibrary/library.xml` plus le dossier `static/`.
Namespace : `http://www.demandware.com/xml/impex/library/2006-10-31`
Ordre XSD : `header`, puis `folder*`, puis `content*`.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<library xmlns="http://www.demandware.com/xml/impex/library/2006-10-31" library-id="BolleEUSharedLibrary">
{header}
{folders}
{contents}
</library>
```

`library-id` est le nom du dossier parent de `library/`. Forme identifiée pour les dossiers (`{folder-id}.xml`) et les contenus (`{content-id}.xml`). L’arborescence métier des folders est portée par l’élément `<parent>` dans chaque fichier, pas par des sous-dossiers de git : un folder reste trouvable par son id au même niveau que les autres.

Un contenu Page Designer (pages, composants, `content-links`) reste un fichier par `content-id`. Les liens vers d’autres contenus sont des références, pas une raison de fusionner les fichiers.

### slots

Absents du dépôt git. Sur STG, chaque site a `sites/{site}/slots.xml`. Bolle_EU : 660 `slot-configuration` et 456 `slot-configuration-campaign-assignment` (0,46 Mo).

Source, par site :

```
ecom-data-sites/sites/Bolle_EU/slots/
├── slots.wrapper.xml
├── configurations/
│   └── minicart-banner__global__minicart-default.xml
└── campaign-assignments/
    └── minicart-banner__global__minicart-default__summer.xml
```

Produit : `sites/Bolle_EU/slots.xml`
Namespace : `http://www.demandware.com/xml/impex/slot/2008-09-08`
Ordre XSD : `slot-configuration*`, puis `slot-configuration-campaign-assignment*`.

Le nom joint par `__`, dans cet ordre, les attributs présents : `slot-id`, `context`, `context-id` (omis s’il est absent, cas `global`), `configuration-id`, et `campaign-id` pour une assignation. Forme identifiée : le `rank` est un élément du fragment, c’est lui qui porte l’ordre d’affichage.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<slot-configurations xmlns="http://www.demandware.com/xml/impex/slot/2008-09-08">
{configurations}
{campaignAssignments}
</slot-configurations>
```

Fragment :

```xml
<slot-configuration slot-id="minicart-banner" context="global" configuration-id="minicart-default" assigned-to-site="true">
    <template>slots/content/htmlSlotContainer.isml</template>
    <enabled-flag>true</enabled-flag>
    <content>
        <content-assets>
            <content-asset content-id="minicart-default"/>
        </content-assets>
    </content>
</slot-configuration>
```

## Reste de l’export STG

Ces fichiers ne sont pas dans le git `ecom-data` aujourd’hui. La règle existe pour que le MCP et les jeux de tests sachent les créer. On ne commite pas l’export STG en bloc : il contient des clients, des comptes BM et des catalogues entiers. On en extrait le fragment dont on a besoin.

L’ordre des colonnes « enfants » est celui du XSD. Le wrapper émet une section seulement si elle a au moins un fragment, sauf mention `minOccurs="1"`.

| Produit dans l’archive | XSD | Grain |
|---|---|---|
| `catalogs/{catalog-id}/catalog.xml` | `catalog.xsd` | `header` (un fichier, `catalog-id` = le dossier). Puis, dans l’ordre : `category/{category-id}`, `product/{product-id}`, `product-option`, `variation-attribute`, `category-assignment/{category-id}__{product-id}`, `recommendation/{source-id}__{source-type}__{target-id}__{type}` |
| `pricebooks/{id}.xml` | `pricebook.xsd` | Déjà un fichier par pricebook. Dedans : `header` obligatoire, puis un `price-table` par `product-id` |
| `inventory-lists/{id}.xml` | `inventory.xsd` | Déjà un fichier par liste. Dedans : `header` obligatoire, puis un `record` par `product-id` |
| `customer-lists/{id}.xml` | `customerlist2.xsd` | `header`, puis un `customer` par `customer-no` |
| `custom-objects/{type}.xml` et `sites/{site}/custom-objects/{type}.xml` | `customobject.xsd` | Déjà un fichier par type. Dedans : un `custom-object` par `object-id`. STG : 13 764 vouchers dans `RXVoucher.xml` |
| `sites/{site}/promotions.xml` | `promotion.xsd` | `campaign/{campaign-id}`, un fichier `global-promotion-settings.xml`, `promotion/{promotion-id}`, `promotion-campaign-assignment/{promotion-id}__{campaign-id}` |
| `sites/{site}/coupons.xml` | `coupon.xsd` | `coupon/{coupon-id}`, `coupon-codes/{coupon-id}` |
| `sites/{site}/stores.xml` | `store.xsd` | `store/{store-id}`, `store-group/{store-group-id}`. Bolle_EU : 5 759 magasins |
| `sites/{site}/abtests.xml` | `abtest.xsd` | un `ab-test` par id |
| `sites/{site}/redirect-urls.xml` | `redirecturl.xsd` | un `redirect-url` ; nom = l’URI assainie, forme ordonnée |
| `sites/{site}/sourcecodes.xml` | `sourcecode.xsd` | un `sourcecode-group` par id |
| `sites/{site}/urls/urlmap` | texte, une ligne par mapping | un fichier par ligne, nom = le chemin assaini. Bolle_EU : ~1 500 lignes |
| `users.xml` | pas dans le jeu d’XSD du toolbox (namespace `…/user/2007-09-05`) | un `user` par `login` |
| `access-roles.xml` | idem, namespace user | un `access-role` par `role-id` |
| `locales.xml` | `locales.xsd` | un `locale` par code |
| `meta` si un `custom-preference-group` apparaît | `metadata.xsd`, après `custom-type` | un fichier par `group-id`, et dedans un `preference-definition` par `preference-id`. Absent de l’export actuel : les préférences custom sont des attributs de `SitePreferences` |

Fichiers laissés entiers : ce sont des réglages uniques, pas une liste qu’on ajoute au quotidien. `version.txt`, le corps de `site.xml` hors `<custom-cartridges>`, `schedules.xml`, `oauth-providers.xml`, `csrf-whitelists.xml`, `priceadjustmentlimits.xml`, `custom-quotas/quota-overrides-v2.xml`, `sitemapconfiguration.xml`, `cache-settings.xml`, `dcext.xml`, `feeds.xml`, `commerce-feature-states.xml`, `customer-cdn-settings.xml`, `search.xml` (ancien schéma `search.xsd`, distinct de `search2.xml`), `sites/{site}/urls/aliases`.

`metadata.xsd` autorise `type-extension`, `custom-type` et `custom-preference-group` dans le même `<metadata>`. L’export et le dépôt les séparent déjà en fichiers. On garde cette séparation. Le MCP n’assemble pas les trois dans un seul XML.

## MCP `ecom-data`

Le développement futur passe par un serveur MCP du dépôt, `tools/ecom-data-mcp/`. Il crée, remplace et retire les fragments. Il ne parle pas à une instance SFCC et il n’écrit pas de XML monolithique.

Il lit les règles de ce document, les XSD de `schemaDir`, et la version de rangs désignée par `ranks`. Avant d’écrire, il vérifie que l’élément est celui attendu par le XSD (nom, attributs requis, ordre des enfants). Un fragment refusé n’est pas écrit. Un type nouveau reçoit son rang via la même règle que `split-export --update-ranks` : `max + 1` dans `ranks/v1.yaml`, écriture de la nouvelle clé, aucune réécriture des clés existantes.

| Outil | Effet |
|---|---|
| `list_rules` | Les types connus, leur chemin source, leur XSD, leur grain |
| `find` | Retrouve un fragment par identifiant (`yotpoLoyaltyTier`, `minicart-default`, `Bolle_EU` + `isRXD2CEnabled`) |
| `create_fragment` | Écrit un fragment nouveau. Crée le wrapper et le dossier de section s’ils manquent. Attribue le prochain rang stable, sans renuméroter les voisins |
| `update_fragment` | Remplace le XML d’un fragment dont l’identifiant existe déjà |
| `delete_fragment` | Supprime le fichier. Ne renumérote pas. Ne retire pas tout seul la ligne `<attribute>` des groupes : la réponse cite les groupes qui référencent encore cet id |
| `validate` | Contrôle un fragment, ou tout un dossier, contre le XSD et contre la règle de nom |
| `compose` | Produit `ecom-data/.composed/` pour l’archive demandée (`meta`, `sites`, ou un sous-ensemble) |

`create_fragment` reçoit le XML intérieur (un seul élément, sans `<?xml` et sans `xmlns`). S’il reçoit un document complet, il n’en garde que l’élément métier. Paramètres minimaux : le type de règle (`system-attribute`, `content`, `slot-configuration`, `job`, `preference`, …), les ids parents (`type-id`, `site-id`, `library-id`, portée), et le XML.

Exemples d’appels utiles au quotidien :

- ajouter `042-CA-monAttribut.xml` sous `Profile`, et créer `042-Profile/` si on est sur un type nouveau (`064-…`)
- ajouter `libraries/BolleEUSharedLibrary/library/content/minicart-default.xml`
- ajouter `sites/Bolle_EU/slots/configurations/minicart-banner__global__minicart-default.xml`
- ajouter `sites/Bolle_EU/preferences/custom-preferences/staging/isRXD2CEnabled.xml`

Le MCP refuse d’écraser un fragment existant via `create_fragment`. Il refuse un chemin qui ne tombe sous aucune règle. Il refuse un rang déjà utilisé. Il ne modifie pas `data-splitter.yaml` : le filtre d’import reste un fichier édité à part, pour que la liste de ce qui est exclu d’un environnement soit visible dans le diff.

## Recomposition

1. Lire `data-splitter.yaml`, puis `data-splitter.<DATA_SPLITTER_ENV>.yaml` s’il existe. Concaténer `disabled` et `allow`.
2. Pour chaque règle, partir du dossier source. Ignorer `.DS_Store`.
3. Appliquer le filtre à chaque fragment. Un wrapper dont le chemin est disabled est exclu avec toute son unité. Un wrapper dont seulement des enfants sont disabled reste, et les sections vides sont omises selon la règle du type.
4. Vérifier le nom. Après retrait du rang (`042-`), du rôle (`SA`, `CA`, `G`) et du rang d’ordre (`01-`), assainir l’identifiant lu dans le XML doit redonner le reste du nom de fichier. L’identifiant dans le XML garde sa forme brute (`Bollé Safety - RET02`, `Agents-65%`).
5. Trier les noms, remplir les placeholders, indenter.
6. Copier les fichiers sans découpage (`version.txt`, le corps de `site.xml`, `static/`). Rejoindre `cartridge-path/` dans `<custom-cartridges>` et dans la préférence `CustomCartridges`.
7. Écrire sous `ecom-data/.composed/ecom-data-meta` et `ecom-data/.composed/ecom-data-sites`.

La comparaison de contrôle est sémantique : mêmes éléments, mêmes attributs, mêmes textes, même ordre des enfants. Les espaces entre balises et la déclaration XML ne comptent pas. L’ordre des attributs sur une balise ne compte pas.

## Script `split-export`

Le script prend une archive d’export site (le dossier qui contient `version.txt`, `meta/`, `sites/`, `libraries/`, …) et écrit l’arbre découpé. C’est le même outil en local et en CI. Il tourne sur l’image Node déjà utilisée par `bitbucket-pipelines.yml`.

La CLI est `sfcc-data` (`sfcc-data-cli`, dépôt voisin). `split` découpe. `compose` recompose.

```bash
sfcc-data split \
  --input /chemin/vers/export \
  --out ecom-data \
  --config ecom-data/data-splitter.yaml \
  --update-ranks
```

| Option | Rôle |
|---|---|
| `--input` | Racine de l’export. Obligatoire |
| `--out` | Racine découpée. Défaut : `ecom-data` |
| `--config` | Défaut : `ecom-data/data-splitter.yaml`. Fournit `ranks`. Les XSD viennent de la CLI, sauf si `schemaDir` est posé |
| `--only` | Liste de produits à découper (`meta`, `sites/Bolle_EU/preferences.xml`, `libraries/BolleEUSharedLibrary`). Défaut : tout ce que l’export contient et qu’une règle connaît |
| `--update-ranks` | Ajoute dans le fichier de rangs les identifiants inconnus, à `max + 1`. Absent en CI de vérification : un id inconnu fait échouer le job |
| `--check` | N’écrit pas les fragments. Échoue si l’arbre `--out` n’est pas celui que cet export et ce fichier de rangs produiraient |

Le script copie `version.txt` tel quel. Il valide chaque fragment contre `sfcc-data-cli/dwapp-schema` avant de l’écrire. Il ne supprime pas un fragment déjà dans `--out` si l’export ne le contient plus : la suppression reste un geste explicite (`delete_fragment` ou retrait du fichier). Il affiche les clés de rang ajoutées, pour que le diff de `ranks/v1.yaml` soit relu.

`sfcc-data compose` fait le chemin inverse : fragments + filtre `disabled` / `allow` → `ecom-data/.composed/`. Le zip d’import (`deploy/activate_code.sh`) pointera vers `.composed/` une fois la découpe du dépôt en place.

### CI

Deux usages, deux jobs. Le pipeline actuel (`bitbucket-pipelines.yml`, image `node:20`) ne les a pas encore.

**Vérification, sur les pull requests qui touchent `ecom-data/`.** Pas d’export externe.

1. `sfcc-data compose` produit `.composed/`.
2. Chaque XML composé est validé contre `sfcc-data-cli/dwapp-schema`.
3. `sfcc-data split --check` sur les fixtures `ecom-data/splitter-fixtures/` : split, compose, comparaison sémantique vide.
4. Un id présent dans les fragments et absent de `ranks/v1.yaml` fait échouer le job. Le correctif est un `--update-ranks` en local, puis le commit du yaml.

**Découpe d’un export, pipeline custom `split-site-export`.** Entrée : un export (artefact du job, ou chemin fourni). Sortie : l’arbre découpé et le `ranks/v1.yaml` complété, en artefact ou en branche, pas poussés tout seuls sur la branche de release.

1. `sfcc-data split --input "$EXPORT_DIR" --out "$WORKDIR" --update-ranks`.
2. `sfcc-data compose` sur ce travail, puis comparaison sémantique avec les XML d’origine de l’export.
3. L’artefact publié est le diff des fragments et de `ranks/v1.yaml`. Un humain choisit ce qui entre dans git. L’export STG entier (clients, comptes, catalogues) ne devient pas le contenu du dépôt par défaut de ce job : `--only` restreint aux zones versionnées, et un second appel sans `--only` sert quand on veut inspecter une library ou un catalogue.

Tant que les monolithiques sont encore dans git, le job de vérification compare la recomposition à ces fichiers. Après égalité sémantique, les monolithiques sortent du dépôt. Jusque-là, on ne change pas ce que `activate_code.sh` zippe.

## Import vers SFCC (`sfcc-ci`)

L’import reprend le chemin déjà en place dans `deploy/activate_code.sh` et `deploy/lib/common.sh` : `sfcc-ci` 2.7, `sfcc_auth` (`SFCC_CLIENT_ID` / `SFCC_CLIENT_SECRET`), certificat `P12` optionnel, et `to_ecdn_host` pour joindre l’instance depuis la CI. `sfcc-ci` n’importe pas un dossier : il importe une archive zip déjà déposée sur l’instance.

Script prévu : `deploy/import_data.sh`. Il source `deploy/lib/common.sh`, compose, zippe, uploade, importe.

```bash
# meta seul, sites seuls, ou les deux dans l'ordre
./deploy/import_data.sh meta
./deploy/import_data.sh sites
./deploy/import_data.sh all

# sous-ensemble, après compose filtré par DATA_SPLITTER_ENV
DATA_SPLITTER_ENV=staging ./deploy/import_data.sh --only sites/Bolle_EU/preferences.xml
```

Variables, les mêmes que l’activation de code :

| Variable | Rôle |
|---|---|
| `SFCC_CLIENT_ID`, `SFCC_CLIENT_SECRET` | `sfcc-ci client:auth` |
| `ACTIVATION_URL` | Instance qui exécute `instance:import` |
| `DEPLOY_URL` | Hôte de `instance:upload` (eCDN). Défaut : `ACTIVATION_URL` |
| `P12` | Certificat client, chemin ou base64. Sans lui, l’upload passe par le token OAuth, comme aujourd’hui |
| `DATA_SPLITTER_ENV` | Choisit `data-splitter.<env>.yaml` au moment du compose |

Étapes de `all` :

1. `sfcc-data compose` écrit `ecom-data/.composed/ecom-data-meta` et `ecom-data/.composed/ecom-data-sites`.
2. Zip de chaque racine. Le zip contient `meta/` ou `sites/`, `version.txt`, et le reste de l’archive à la racine, pas un dossier `ecom-data-sites/` en trop.
3. `sfcc_ci instance:upload <zip> -i "$DEPLOY_URL"` (`-c "$P12_PATH"` si le certificat est là).
4. `sfcc_ci instance:import <zip> -i "$ACTIVATION_URL" -s`. `-s` attend la fin. Le script sort en erreur si le journal contient une erreur d’import.
5. Les zip sont effacés, comme `ecom-data-meta.zip` aujourd’hui.

`--only` construit une archive partielle : uniquement les fichiers composés demandés, plus `version.txt` et les wrappers nécessaires pour que le XML reste valide. Le filtre `disabled` / `allow` s’applique avant, donc un import STG peut exclure une library tout en gardant un asset.

Ordre imposé par la plateforme :

1. La version de code qui porte les cartridges est déjà active. `activate_code.sh` le fait avant l’import meta.
2. L’archive **meta** est importée avant l’archive **sites**. Les valeurs de préférences et les jobs référencent des attributs et des step types qui doivent déjà exister.
3. Les jobs custom sont validés contre les `steptypes.json` de la version de code active. Un step `custom.*` absent de ces fichiers fait échouer l’import du job, même si l’id commence par `custom.`.

C’est le cas de `SiteMaps-Init` / `custom.SiteMapsInit` : aucun `steptypes.json` de ce dépôt ne déclare ce type. Un `jobs.xml` qui contient ce step est rejeté tant que la cartridge qui l’enregistre n’est pas sur la version active, ou tant que le step n’est pas retiré du job. L’import sites ne « répare » pas ce point. Il remonte le journal `sfcc-ci`.

`activate_code.sh` garde son drapeau `IMPORT_METADATA`. Quand la découpe est en place, ce drapeau appelle `import_data.sh meta` au lieu de zipper le dossier monolithique. L’import sites reste une commande séparée : il n’est pas couplé à chaque activation de code.

Pipeline custom `import-site-data`, à ajouter à `bitbucket-pipelines.yml` à côté de `split-site-export`. Il ne tourne pas sur les pull requests. Il reprend le step d’auth déjà utilisé par `upload-and-activate`, puis `./deploy/import_data.sh` avec la cible en variable (`meta`, `sites` ou `all`).

## Jeux de tests

Les fixtures vivent dans `ecom-data/splitter-fixtures/`. Ce dossier est hors des deux archives zippées. Chaque cas a `source/`, `expected/`, et éventuellement un `data-splitter.yaml` local qui remplace le filtre le temps du test.

La comparaison est la comparaison sémantique décrite plus haut. Chaque cas échoue aussi si un fragment contient une déclaration XML, un `xmlns`, ou un placeholder.

| Cas | Ce qu’il verrouille |
|---|---|
| `system-profile` | Profile avec `UUID`, `taxIDType`, un attribut custom, le groupe `Standard`. Recomposition égale au XML attendu. Section absente omise. |
| `system-empty` | `TrackingRef` sans section → `<type-extension type-id="TrackingRef"/>`. |
| `custom-rxvoucher` | Un custom type, `header.xml`, deux attributs dont `FrameOfferSegment`. Le filtre disable ce fichier : le XML produit contient l’attribut resté actif. Le fichier de groupe du fixture ne cite que les attributs encore importés. |
| `preferences-scope` | Même `preference-id` sous `development` et `production`, valeurs différentes, chacune dans la bonne portée. Une portée sans fichier est absente du XML. |
| `library-allow` | Deux `<content>`, un `<folder>`. Disabled sur `library/content`, allow sur `minicart-default.xml`. Le `library.xml` produit contient le folder et ce seul content. `static/` est copié. |
| `library-disabled` | Disabled sur le dossier de la library : ni `library.xml` ni `static/` dans le produit. |
| `slots` | Deux configurations et une assignation campagne. Disabled sur une configuration : le `slots.xml` produit garde l’autre configuration, puis l’assignation, dans l’ordre du XSD. |
| `filename-sanitize` | Job id `Bollé Safety - RET02`. Le fichier est `Bollé-Safety-RET02.xml` (accent conservé, espaces devenus `-`) et le `job-id` du XML reste `Bollé Safety - RET02`. |
| `filter-specificity` | Disabled sur un dossier et allow sur un fichier de ce dossier ; puis l’inverse (allow sur le dossier, disabled sur un fichier). Le motif le plus long gagne. |
| `coexistence` | Dossier découpé et fichier monolithique du même type présents ensemble → erreur, pas de fichier produit. |
| `unknown-type` | Un XML d’archive sans règle → erreur. |

`library-allow` et `slots` sont les références minimales des types absents du dépôt. Leur `source/` suit exactement les arbres de ce document, avec un seul folder `root`, deux contents (`minicart-default`, `footer`), et deux slot-configurations `minicart-banner__global__minicart-default` et `header-banner__global__header-default`.

Un cas supplémentaire, `ranks-version`, verrouille le fichier de rangs : un export qui contient `Profile` et un type inconnu échoue sans `--update-ranks`, et avec le drapeau n’ajoute que le type inconnu. `Profile` reste à la valeur déjà écrite dans `ranks/v1.yaml`.

`cartridge-path` verrouille l’ordre et le doublon : `010-app_a`, `030-app_c` et deux fichiers `lib_productlist` à des rangs différents recomposent la chaîne dans l’ordre des préfixes, avec `lib_productlist` deux fois. Deux fichiers du même dossier qui partagent le même préfixe font échouer la recomposition.
