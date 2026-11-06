import assert from 'node:assert/strict'
import test from 'node:test'
import { diffLines, diffStats } from '../src/renderer/src/utils/diff.ts'
import { estimateResourceCost } from '../src/renderer/src/utils/costEstimates.ts'
import { parseDotToReactFlow } from '../src/renderer/src/utils/dotParser.ts'
import { extractHclBlock, parseResourcesInFile } from '../src/main/hcl.ts'
import { parseSecurityFindings } from '../src/main/security-findings.ts'

test('diff round-trips both revisions and counts changes', () => {
  const before = 'a\nb\nc'
  const after = 'a\nchanged\nc\nd'
  const diff = diffLines(before, after)
  assert.equal(
    diff
      .filter((l) => l.type !== 'add')
      .map((l) => l.text)
      .join('\n'),
    before
  )
  assert.equal(
    diff
      .filter((l) => l.type !== 'del')
      .map((l) => l.text)
      .join('\n'),
    after
  )
  assert.deepEqual(diffStats(diff), { added: 2, removed: 1 })
})
test('DOT graph includes isolated nodes and implicit edge targets', () => {
  const graph = parseDotToReactFlow(
    '"aws_vpc.main" [label="aws_vpc.main"]; "aws_vpc.main" -> "aws_subnet.main";'
  )
  assert.equal(graph.nodes.length, 2)
  assert.equal(graph.edges[0].target, 'aws_subnet.main')
})
test('HCL extracts nested resources without consuming the next block', () => {
  const text =
    'resource "aws_instance" "web" {\n instance_type = "t3.small"\n tags = { Name = "{web}" }\n}\nresource "aws_vpc" "main" { cidr_block = "10.0.0.0/16" }'
  assert.match(extractHclBlock(text, 'aws_instance.web'), /t3.small/)
  assert.ok(!extractHclBlock(text, 'aws_instance.web').includes('cidr_block'))
  assert.equal(extractHclBlock(text, 'aws_instance.missing'), null)
  assert.equal(parseResourcesInFile(text).length, 2)
})
test('cost estimate changes with instance size and unknown types remain unpriced', () => {
  const small = estimateResourceCost('aws_instance.web', { instance_type: 't3.small' })
  const large = estimateResourceCost('aws_instance.web', { instance_type: 't3.large' })
  assert.ok(large.monthly > small.monthly)
  assert.equal(estimateResourceCost('unknown_resource.web', {}), null)
})
test('Trivy and legacy tfsec findings preserve source locations', () => {
  const trivy = parseSecurityFindings({
    Results: [
      {
        Target: 'main.tf',
        Misconfigurations: [
          {
            ID: 'AVD-1',
            Severity: 'HIGH',
            CauseMetadata: { Resource: 'aws_s3_bucket.public', StartLine: 4 }
          }
        ]
      }
    ]
  })
  assert.equal(trivy[0].resource, 'aws_s3_bucket.public')
  assert.equal(trivy[0].line, 4)
  const legacy = parseSecurityFindings({
    results: [{ rule_id: 'old', location: { filename: 'vpc.tf', start_line: 8 } }]
  })
  assert.equal(legacy[0].file, 'vpc.tf')
  assert.deepEqual(parseSecurityFindings({ Results: [] }), [])
})
