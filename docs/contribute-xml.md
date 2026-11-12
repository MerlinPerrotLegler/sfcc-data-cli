# Contribute an ecom-data XML

A fragment is the business element, without `<?xml` and without `xmlns`. The folder wrapper carries the declaration, the namespace, and the XSD order. Do not write the monolithic archive by hand.

Tool: the `sfcc-data` MCP (`list_rules`, `find`, `create_fragment`, `update_fragment`, `delete_fragment`, `validate`). `create_fragment` refuses to overwrite. `delete_fragment` does not renumber. It does not remove an `<attribute>` line from a group on its own: it reports the groups that still cite the id.

Ranks in `ecom-data/ranks` are not reused and are not renumbered. A new id takes `max + 1`. Two files in the same folder with the same numeric prefix fail recomposition.

Three trees:

- `ecom-data-meta` — metadata
- `ecom-data-sites` — catalog configuration only (header, categories, assignments, recommendations, options, variation attributes)
- `ecom-data-sites-dev` — full dataset

A test case that must survive a download goes in `ecom-data-sites-test/<case>/`, as monolithic XML. `download` and `split` do not write there.

After a CLI update: `sfcc-data init`. `sfcc-data init --check` fails when the installed rule or MCP server is no longer this version.

## system-attribute

**System attribute.** Archive `ecom-data-meta`.

Path: `ecom-data-meta/meta/system-objecttype-extensions/{rank}-{type-id}/system-attribute-definitions/{rank}-SA-{attribute-id}.xml`
Element: `<attribute-definition>`. XSD: `metadata.xsd`.

One file per attribute-id. The rank is the type rank, already in the folder name. A new type takes max+1 in ranks, without renumbering the others. No <?xml, no xmlns.

## custom-attribute

**Custom attribute of a system type.** Archive `ecom-data-meta`.

Path: `ecom-data-meta/meta/system-objecttype-extensions/{rank}-{type-id}/custom-attribute-definitions/{rank}-CA-{attribute-id}.xml`
Element: `<attribute-definition>`. XSD: `metadata.xsd`.

Same rank as the type. value-definition elements stay in the attribute file, in Business Manager order. Removing the attribute means deleting this file and the <attribute> line in every group that cites it.

## attribute-group

**Attribute group.** Archive `ecom-data-meta`.

Path: `ecom-data-meta/meta/system-objecttype-extensions/{rank}-{type-id}/group-definitions/{rank}-G-{order}-{group-id}.xml`
Element: `<attribute-group>`. XSD: `metadata.xsd`.

One group, one file. The order of <attribute> elements inside the file is the field order. The group order itself is the G-01, G-02 prefix. Insert a step between two neighbours; do not renumber.

## custom-type-header

**Custom type header.** Archive `ecom-data-meta`.

Path: `ecom-data-meta/meta/custom-objecttype-definitions/{rank}-{type-id}/header.xml`

A single header.xml: display-name, description, staging-mode, storage-scope, retention-days, key-definition, in XSD order. The key is not split out. Required to recompose the type.

## custom-type-attribute

**Custom type attribute.** Archive `ecom-data-meta`.

Path: `ecom-data-meta/meta/custom-objecttype-definitions/{rank}-{type-id}/attribute-definitions/{rank}-CA-{attribute-id}.xml`
Element: `<attribute-definition>`. XSD: `metadata.xsd`.

The type folder and header.xml must already exist. Deleting the type means deleting the whole folder.

## custom-type-group

**Custom type group.** Archive `ecom-data-meta`.

Path: `ecom-data-meta/meta/custom-objecttype-definitions/{rank}-{type-id}/group-definitions/{rank}-G-{order}-{group-id}.xml`
Element: `<attribute-group>`. XSD: `metadata.xsd`.

Same rule as system groups. The type rank does not change.

## job

**Job.** Archive `ecom-data-sites-dev`.

Path: `ecom-data-sites-dev/jobs/{job-id}.xml`
Element: `<job>`. XSD: `jobs.xsd`.

One whole <job> per file. Do not split <step> elements. A step only makes sense inside its job.

## service-credential

**Service credential.** Archive `ecom-data-sites-dev`.

Path: `ecom-data-sites-dev/services/service-credential/{service-credential-id}.xml`
Element: `<service-credential>`. XSD: `services.xsd`.

XSD order is credential, then profile, then service. A password with encrypted="true" stays as it is.

## service-profile

**Service profile.** Archive `ecom-data-sites-dev`.

Path: `ecom-data-sites-dev/services/service-profile/{service-profile-id}.xml`
Element: `<service-profile>`. XSD: `services.xsd`.

One complete <service-profile>. Do not reorder the three folders.

## service

**Service.** Archive `ecom-data-sites-dev`.

Path: `ecom-data-sites-dev/services/service/{service-id}.xml`
Element: `<service>`. XSD: `services.xsd`.

One complete <service>. The credential and the profile stay in their own files.

## preference

**Preference.** Archive `ecom-data-sites-dev`.

Path: `ecom-data-sites-dev/preferences/{standard|custom}-preferences/{scope}/{preference-id}.xml ou sites/{site}/preferences/…`
Element: `<preference>`. XSD: `preferences.xsd`.

One preference, one scope, one file. development and production do not share a file. Scopes: all-instances, development, staging, production. The organization has no site-id. CustomCartridges is not a preference: it is the cartridge-path file.

## cartridge

**Cartridge.** Archive `ecom-data-sites-dev`.

Path: `ecom-data-sites-dev/sites/{site}/cartridge-path ou ecom-data-sites-dev/cartridge-path`

One file. One cartridge name per line, in path order. The same name may appear twice. Without a site-id, this is the Business Manager path (CustomCartridges preference).

## customer-group

**Customer group.** Archive `ecom-data-sites-dev`.

Path: `ecom-data-sites-dev/sites/{site}/customer-groups/customer-group/{group-id}.xml`
Element: `<customer-group>`. XSD: `customergroup.xsd`.

group-id in the XML keeps spaces and %. The file name is sanitized (Agents-65% → Agents-65).

## group-assignment

**Group assignment.** Archive `ecom-data-sites-dev`.

Path: `ecom-data-sites-dev/sites/{site}/customer-groups/group-assignment/{group-id}__{customer-no}.xml`
Element: `<group-assignment>`. XSD: `customergroup.xsd`.

The file name joins group-id and customer-no with __.

## payment-method

**Payment method.** Archive `ecom-data-sites-dev`.

Path: `ecom-data-sites-dev/sites/{site}/payment-methods/payment-method/{order}-{method-id}.xml`
Element: `<payment-method>`. XSD: `paymentsettings.xsd`.

Business Manager order is the file order. Add a step; do not renumber.

## payment-card

**Payment card.** Archive `ecom-data-sites-dev`.

Path: `ecom-data-sites-dev/sites/{site}/payment-methods/payment-card/{order}-{card-type}.xml`
Element: `<payment-card>`. XSD: `paymentsettings.xsd`.

Same archive as payment methods. Ordered list.

## payment-processor

**Payment processor.** Archive `ecom-data-sites-dev`.

Path: `ecom-data-sites-dev/sites/{site}/payment-processors/{processor-id}.xml`
Element: `<payment-processor>`. XSD: `paymentprocessor.xsd`.

The processor <preferences> block stays in the same file.

## shipping-method

**Shipping method.** Archive `ecom-data-sites-dev`.

Path: `ecom-data-sites-dev/sites/{site}/shipping/{order}-{method-id}.xml`
Element: `<shipping-method>`. XSD: `shipping.xsd`.

Checkout order follows the files. default="true" stays on the element.

## tax-class

**Tax class.** Archive `ecom-data-sites-dev`.

Path: `ecom-data-sites-dev/sites/{site}/tax/tax-classes/{class-id}.xml`
Element: `<tax-class>`. XSD: `tax.xsd`.

Wrapper order: classes, jurisdictions, rates.

## tax-jurisdiction

**Tax jurisdiction.** Archive `ecom-data-sites-dev`.

Path: `ecom-data-sites-dev/sites/{site}/tax/tax-jurisdictions/{jurisdiction-id}.xml`
Element: `<tax-jurisdiction>`. XSD: `tax.xsd`.

One file per jurisdiction-id.

## tax-rate

**Tax rate.** Archive `ecom-data-sites-dev`.

Path: `ecom-data-sites-dev/sites/{site}/tax/tax-rates/{jurisdiction-id}__{class-id}.xml`
Element: `<tax-rate>`. XSD: `tax.xsd`.

The name joins jurisdiction-id and class-id.

## library-folder

**Library folder.** Archive `ecom-data-sites-dev`.

Path: `ecom-data-sites-dev/libraries/{library}/library/folder/{folder-id}.xml`
Element: `<folder>`. XSD: `library.xsd`.

library-id selects the shared library. site-id alone selects the site library. The business tree is the <parent> element, not a git subdirectory. header.xml is optional.

## library-content

**Library content.** Archive `ecom-data-sites-dev`.

Path: `ecom-data-sites-dev/libraries/{library}/library/content/{content-id}.xml`
Element: `<content>`. XSD: `library.xsd`.

One file per content-id, including a Page Designer page. static/ next to library/ is copied as-is; it is not a fragment.

## slot-configuration

**Slot configuration.** Archive `ecom-data-sites-dev`.

Path: `ecom-data-sites-dev/sites/{site}/slots/configurations/{slot-id}__{context}__{context-id}__{configuration-id}.xml`
Element: `<slot-configuration>`. XSD: `slot.xsd`.

The name joins the attributes that are present, in that order. context-id is omitted when it is absent (global context). Display order is the rank element, not the file name.

## slot-campaign-assignment

**Slot campaign assignment.** Archive `ecom-data-sites-dev`.

Path: `ecom-data-sites-dev/sites/{site}/slots/campaign-assignments/{slot-id}__{context}__{configuration-id}__{campaign-id}.xml`
Element: `<slot-configuration-campaign-assignment>`. XSD: `slot.xsd`.

Same join, with campaign-id added.

## category

**Category.** Archive `ecom-data-sites`.

Path: `ecom-data-sites/catalogs/{catalog}/catalog/category/{category-id}.xml`
Element: `<category>`. XSD: `catalog.xsd`.

Catalog configuration lives in ecom-data-sites. header.xml carries the catalog-id. Do not put products here.

## category-assignment

**Category assignment.** Archive `ecom-data-sites`.

Path: `ecom-data-sites/catalogs/{catalog}/catalog/category-assignment/{category-id}__{product-id}.xml`
Element: `<category-assignment>`. XSD: `catalog.xsd`.

Catalog configuration. The name joins category-id and product-id.

## recommendation

**Recommendation.** Archive `ecom-data-sites`.

Path: `ecom-data-sites/catalogs/{catalog}/catalog/recommendation/{source-id}__{source-type}__{target-id}__{type}.xml`
Element: `<recommendation>`. XSD: `catalog.xsd`.

Catalog configuration. Four attributes joined by __.

## product-option

**Product option.** Archive `ecom-data-sites`.

Path: `ecom-data-sites/catalogs/{catalog}/catalog/product-option/{option-id}.xml`
Element: `<product-option>`. XSD: `catalog.xsd`.

Catalog configuration.

## variation-attribute

**Variation attribute.** Archive `ecom-data-sites`.

Path: `ecom-data-sites/catalogs/{catalog}/catalog/variation-attribute/{variation-attribute-id}.xml`
Element: `<variation-attribute>`. XSD: `catalog.xsd`.

Catalog configuration.

## product

**Product.** Archive `ecom-data-sites-dev`.

Path: `ecom-data-sites-dev/catalogs/{catalog}/catalog/product/{product-id}.xml`
Element: `<product>`. XSD: `catalog.xsd`.

A product belongs to the full dataset, so it goes in ecom-data-sites-dev, not in catalog configuration.

## catalog-header

**Catalog header.** Archive `ecom-data-sites`.

Path: `ecom-data-sites/catalogs/{catalog}/catalog/header.xml`
Element: `<header>`. XSD: `catalog.xsd`.

A single header.xml per catalog. It carries the catalog identity.

## price-table

**Price.** Archive `ecom-data-sites-dev`.

Path: `ecom-data-sites-dev/pricebooks/{pricebook}/price-tables/{product-id}.xml`
Element: `<price-table>`. XSD: `pricebook.xsd`.

header.xml is required. The existing wrapper is kept: split a new price book first; do not invent its envelope.

## inventory-record

**Inventory.** Archive `ecom-data-sites-dev`.

Path: `ecom-data-sites-dev/inventory-lists/{inventory}/records/{product-id}.xml`
Element: `<record>`. XSD: `inventory.xsd`.

header.xml is required. Same constraint as a price book: the wrapper must already exist.

## customer

**Customer.** Archive `ecom-data-sites-dev`.

Path: `ecom-data-sites-dev/customer-lists/{list}/customer/{customer-no}.xml`
Element: `<customer>`. XSD: `customerlist2.xsd`.

One customer per file. XML import does not set a usable password. Test datasets that must survive a download go in ecom-data-sites-test, not here.

## custom-object

**Custom object.** Archive `ecom-data-sites-dev`.

Path: `ecom-data-sites-dev/custom-objects/{type}/{object-id}.xml`
Element: `<custom-object>`. XSD: `customobject.xsd`.

One file per object-id. site-id places the object on the site. A test case (voucher, request) stays in ecom-data-sites-test/<case>, zipped as-is.

## campaign

**Campaign.** Archive `ecom-data-sites-dev`.

Path: `ecom-data-sites-dev/sites/{site}/promotions/campaign/{campaign-id}.xml`
Element: `<campaign>`. XSD: `promotion.xsd`.

global-promotion-settings.xml is a single file at the unit root, not a folder.

## promotion

**Promotion.** Archive `ecom-data-sites-dev`.

Path: `ecom-data-sites-dev/sites/{site}/promotions/promotion/{promotion-id}.xml`
Element: `<promotion>`. XSD: `promotion.xsd`.

One <promotion> per file.

## promotion-assignment

**Promotion campaign assignment.** Archive `ecom-data-sites-dev`.

Path: `ecom-data-sites-dev/sites/{site}/promotions/promotion-campaign-assignment/{promotion-id}__{campaign-id}.xml`
Element: `<promotion-campaign-assignment>`. XSD: `promotion.xsd`.

The name joins promotion-id and campaign-id.

## coupon

**Coupon.** Archive `ecom-data-sites-dev`.

Path: `ecom-data-sites-dev/sites/{site}/coupons/coupon/{coupon-id}.xml`
Element: `<coupon>`. XSD: `coupon.xsd`.

A coupon's codes are the other folder, coupon-codes, one file per coupon-id.

## coupon-codes

**Coupon codes.** Archive `ecom-data-sites-dev`.

Path: `ecom-data-sites-dev/sites/{site}/coupons/coupon-codes/{coupon-id}.xml`
Element: `<coupon-codes>`. XSD: `coupon.xsd`.

The whole code block of one coupon fits in one file.

## store

**Store.** Archive `ecom-data-sites-dev`.

Path: `ecom-data-sites-dev/sites/{site}/stores/store/{store-id}.xml`
Element: `<store>`. XSD: `store.xsd`.

One store per file. Groups are store-group/{store-group-id}.xml.

## store-group

**Store group.** Archive `ecom-data-sites-dev`.

Path: `ecom-data-sites-dev/sites/{site}/stores/store-group/{store-group-id}.xml`
Element: `<store-group>`. XSD: `store.xsd`.

One group per file.

## ab-test

**A/B test.** Archive `ecom-data-sites-dev`.

Path: `ecom-data-sites-dev/sites/{site}/abtests/{test-id}.xml`
Element: `<ab-test>`. XSD: `abtest.xsd`.

One <ab-test> per file.

## redirect-url

**Redirect URL.** Archive `ecom-data-sites-dev`.

Path: `ecom-data-sites-dev/sites/{site}/redirect-urls/{order}-{uri}.xml`
Element: `<redirect-url>`. XSD: `redirecturl.xsd`.

No stable id. The name carries the sanitized URI and an order rank. Do not drop the rank of neighbours.

## sourcecode-group

**Source code group.** Archive `ecom-data-sites-dev`.

Path: `ecom-data-sites-dev/sites/{site}/sourcecodes/{group-id}.xml`
Element: `<sourcecode-group>`. XSD: `sourcecode.xsd`.

One group per file.

## user

**Business Manager user.** Archive `ecom-data-sites-dev`.

Path: `ecom-data-sites-dev/users/{login}.xml`
Element: `<user>`. XSD: `user`.

One user per login. A download does not include users by default. Do not put a plaintext secret here.

## access-role

**Access role.** Archive `ecom-data-sites-dev`.

Path: `ecom-data-sites-dev/access-roles/{role-id}.xml`
Element: `<access-role>`. XSD: `user`.

One role per file.

## locale

**Locale.** Archive `ecom-data-sites-dev`.

Path: `ecom-data-sites-dev/locales/{locale-id}.xml`
Element: `<locale>`. XSD: `locales.xsd`.

One <locale> per code.

## pipeline-alias

**Pipeline alias.** Archive `ecom-data-sites-dev`.

Path: `ecom-data-sites-dev/sites/{site}/url-rules/pipeline-aliases/{lang}/{pipeline}.xml`
Element: `<pipeline-alias>`. XSD: `urlrules.xsd`.

Scalar settings stay in the wrapper. Add an alias only when url-rules.wrapper.xml already exists. The default language is x-default.

## character-replacement

**Character replacement.** Archive `ecom-data-sites-dev`.

Path: `ecom-data-sites-dev/sites/{site}/url-rules/character-replacements/{lang}/{character}.xml`
Element: `<character-replacement>`. XSD: `urlrules.xsd`.

The name is the sanitized character. The wrapper must already exist.

## page-meta-definition

**Page meta tag definition.** Archive `ecom-data-sites-dev`.

Path: `ecom-data-sites-dev/pagemetatag/page-meta-tag-definitions/{meta-tag-id}.xml`
Element: `<page-meta-tag-definition>`. XSD: `pagemetatag.xsd`.

If two definitions share a meta-tag-id with a different type, the name becomes {meta-tag-id}__{type}.xml. Without a site-id, this is the organization file.

## page-meta-rule

**Page meta tag rule.** Archive `ecom-data-sites-dev`.

Path: `ecom-data-sites-dev/pagemetatag/page-meta-tag-rules/{page-type}/{order}-{rule-id}.xml`
Element: `<page-meta-tag-rule>`. XSD: `pagemetatag.xsd`.

page-type is the parent element name: product-detail-page-meta-tag-rules, product-listing-page-meta-tag-rules, content-detail-page-meta-tag-rules, content-listing-page-meta-tag-rules.

## sorting-rule

**Sorting rule.** Archive `ecom-data-sites-dev`.

Path: `ecom-data-sites-dev/sort/sorting-rule/{rule-id}.xml`
Element: `<sorting-rule>`. XSD: `sort.xsd`.

sorting-options.xml is a single file. Assignments join rule-id and category-id. Without a site-id, this is the organization sort.

## searchable-attribute

**Searchable attribute.** Archive `ecom-data-sites-dev`.

Path: `ecom-data-sites-dev/sites/{site}/search2/searchable-attributes/{attribute-path}.xml`
Element: `<searchable-attribute>`. XSD: `search2.xsd`.

The name is the sanitized attribute-path (product.name → product-name). Language lists (stopword, synonym, …) are one file per xml:lang, and their entries stay inside.

## search-redirect

**Search redirect.** Archive `ecom-data-sites-dev`.

Path: `ecom-data-sites-dev/sites/{site}/search2/redirect-list/{order}.xml`
Element: `<redirect>`. XSD: `search2.xsd`.

No stable id. The file is named 01.xml, 02.xml. The keyword stays in the XML.

## ocapi-client

**OCAPI client.** Archive `ecom-data-sites-dev`.

Path: `ecom-data-sites-dev/ocapi-settings/wapi_data_config/clients/{client_id}.json`

One client per file, keyed by client_id. file is wapi_data_config or wapi_shop_config. With a site-id, it is the site wapi_shop_config. _v stays in the JSON wrapper. Do not concatenate the JSON by hand.

## webdav-client

**WebDAV client.** Archive `ecom-data-sites-dev`.

Path: `ecom-data-sites-dev/webdav/client_permissions/clients/{client_id}.json`

One object from the clients array. Same idea as OCAPI: the wrapper keeps the rest of the document, and the file contains only one client.

## urlmap

**urlmap line.** Archive `ecom-data-sites-dev`.

Path: `ecom-data-sites-dev/sites/{site}/urls/urlmap/{path}.txt`

The monolithic urlmap file must no longer be there. One line per file. The name is the sanitized path. The body is the whole line.
